import { ApiPromise, WsProvider } from '@polkadot/api';
import { Network } from '../model/substrate/network';
import {
    RPCSubscriptionService,
    RPCSubscriptionServiceListener,
} from '../service/rpc/RPCSubscriptionService';
import { NetworkStatusUpdate } from '../model/subvt/network-status';
import { ValidatorListUpdate } from '../model/subvt/validator-summary';
import { setAsyncTimeout } from '../util/async-util';
import { EventBus } from '../event/event-bus';
import { Constants } from '../util/constants';
import { ChainvizEvent } from '../event/event';
import { UnsubscribePromise } from '@polkadot/api/types';
import { Slot } from '../model/chainviz/slot';
import { Block } from '../model/chainviz/block';
import { BlockHash } from '@polkadot/types/interfaces';
import { AnyJson } from '@polkadot/types/types';
import { XCMInfo, XCMInfoWrapper, isXCMInfo } from '../model/polkaholic/xcm';

class DataStore {
    private network!: Network;
    private substrateClient!: ApiPromise;
    private networkStatusClient!: RPCSubscriptionService<NetworkStatusUpdate>;
    private activeValidatorListClient!: RPCSubscriptionService<ValidatorListUpdate>;
    private readonly eventBus = EventBus.getInstance();
    private newBlockSubscription?: UnsubscribePromise;
    private finalizedHeaderSubscription?: UnsubscribePromise;

    private readonly networkStatusListener: RPCSubscriptionServiceListener<NetworkStatusUpdate> = {
        onConnected: () => {
            this.eventBus.dispatch<string>(ChainvizEvent.NETWORK_STATUS_SERVICE_CONNECTED);
        },
        onSubscribed: (_subscriptionId: number) => {
            this.eventBus.dispatch<string>(ChainvizEvent.NETWORK_STATUS_SERVICE_SUBSCRIBED);
        },
        onUnsubscribed: (_subscriptionId: number) => {
            this.eventBus.dispatch<string>(ChainvizEvent.NETWORK_STATUS_SERVICE_UNSUBSCRIBED);
        },
        onDisconnected: () => {
            this.eventBus.dispatch<string>(ChainvizEvent.NETWORK_STATUS_SERVICE_DISCONNECTED);
        },
        onUpdate: (update: NetworkStatusUpdate) => {
            this.processNetworkStatusUpdate(update);
        },
        onError: (code: number, message: string) => {
            console.log(`Network status service error (${code}: ${message}).`);
            this.eventBus.dispatch<string>(ChainvizEvent.NETWORK_STATUS_SERVICE_ERROR);
        },
    };

    private readonly activeValidatorListListener: RPCSubscriptionServiceListener<ValidatorListUpdate> =
        {
            onConnected: () => {
                this.eventBus.dispatch<string>(
                    ChainvizEvent.ACTIVE_VALIDATOR_LIST_SERVICE_CONNECTED,
                );
            },
            onSubscribed: (_subscriptionId: number) => {
                this.eventBus.dispatch<string>(
                    ChainvizEvent.ACTIVE_VALIDATOR_LIST_SERVICE_SUBSCRIBED,
                );
            },
            onUnsubscribed: (_subscriptionId: number) => {
                this.eventBus.dispatch<string>(
                    ChainvizEvent.ACTIVE_VALIDATOR_LIST_SERVICE_UNSUBSCRIBED,
                );
            },
            onDisconnected: () => {
                this.eventBus.dispatch<string>(
                    ChainvizEvent.ACTIVE_VALIDATOR_LIST_SERVICE_DISCONNECTED,
                );
            },
            onUpdate: (update: ValidatorListUpdate) => {
                this.processActiveValidatorListUpdate(update);
            },
            onError: (code: number, message: string) => {
                console.log(`Validator list service error (${code}: ${message}).`);
                this.eventBus.dispatch<string>(ChainvizEvent.ACTIVE_VALIDATOR_LIST_SERVICE_ERROR);
            },
        };

    setNetwork(network: Network) {
        this.network = network;
    }

    async connectSubstrateRPC() {
        this.substrateClient = new ApiPromise({
            provider: new WsProvider(this.network.rpcURL),
        });
        try {
            await setAsyncTimeout(async (done) => {
                await this.substrateClient.isReady;
                done(0);
            }, Constants.CONNECTION_TIMEOUT_MS);
            this.eventBus.dispatch<string>(ChainvizEvent.SUBSTRATE_API_READY);
        } catch (error) {
            this.eventBus.dispatch<string>(ChainvizEvent.SUBSTRATE_API_CONNECTION_TIMED_OUT);
        }
    }

    connectNetworkStatusService() {
        this.networkStatusClient = new RPCSubscriptionService(
            this.network.networkStatusServiceURL,
            'subscribe_networkStatus',
            'unsubscribe_networkStatus',
            this.networkStatusListener,
        );
        this.networkStatusClient.connect();
    }

    disconnectNetworkStatusService() {
        this.networkStatusClient.disconnect();
    }

    subscribeToNetworkStatus() {
        this.networkStatusClient.subscribe();
    }

    connectActiveValidatorListService() {
        this.activeValidatorListClient = new RPCSubscriptionService(
            this.network.activeValidatorListServiceURL,
            'subscribe_validatorList',
            'unsubscribe_validatorList',
            this.activeValidatorListListener,
        );
        this.activeValidatorListClient.connect();
    }

    disconnectActiveValidatorListService() {
        this.activeValidatorListClient.disconnect();
    }

    subscribeToActiveValidatorList() {
        this.activeValidatorListClient.subscribe();
    }

    processNetworkStatusUpdate(update: NetworkStatusUpdate) {
        this.eventBus.dispatch<NetworkStatusUpdate>(ChainvizEvent.NETWORK_STATUS_UPDATE, update);
    }

    processActiveValidatorListUpdate(update: ValidatorListUpdate) {
        this.eventBus.dispatch<ValidatorListUpdate>(
            ChainvizEvent.ACTIVE_VALIDATOR_LIST_UPDATE,
            update,
        );
    }

    async getInitialSlots(): Promise<Slot[]> {
        const finalizedSlots: Slot[] = [];
        // get finalized blocks
        const finalizedBlockHash = await this.substrateClient.rpc.chain.getFinalizedHead();
        const lastFinalizedBlock = await this.getBlockByHash(finalizedBlockHash);
        finalizedSlots.push(
            new Slot(lastFinalizedBlock.block.header.number.toNumber(), true, [lastFinalizedBlock]),
        );
        let finalizedBlock = lastFinalizedBlock;
        for (let i = Constants.INITIAL_SLOT_COUNT - 1; i > 0; i--) {
            finalizedBlock = await this.getBlockByHash(finalizedBlock.block.header.parentHash);
            finalizedSlots.push(
                new Slot(finalizedBlock.block.header.number.toNumber(), true, [finalizedBlock]),
            );
        }
        // get non-finalized blocks
        const nonFinalizedSlots: Slot[] = [];
        const lastHeader = await this.substrateClient.rpc.chain.getHeader();
        let nonFinalizedSubstrateBlock = (
            await this.substrateClient.rpc.chain.getBlock(lastHeader.hash)
        ).block;
        while (
            nonFinalizedSubstrateBlock.header.hash.toHex() !=
            lastFinalizedBlock.block.header.hash.toHex()
        ) {
            const nonFinalizedBlock = await this.getBlockByHash(
                nonFinalizedSubstrateBlock.header.hash,
            );
            nonFinalizedSlots.push(
                new Slot(nonFinalizedBlock.block.header.number.toNumber(), false, [
                    nonFinalizedBlock,
                ]),
            );
            nonFinalizedSubstrateBlock = (
                await this.substrateClient.rpc.chain.getBlock(
                    nonFinalizedBlock.block.header.parentHash,
                )
            ).block;
        }
        return [...nonFinalizedSlots, ...finalizedSlots];
    }

    async getParaIds(): Promise<number[]> {
        return (await this.substrateClient.query.paras.parachains()).toJSON() as number[];
    }

    subsribeToNewBlocks() {
        if (this.newBlockSubscription) {
            return;
        }
        this.newBlockSubscription = this.substrateClient.rpc.chain.subscribeNewHeads(
            async (header) => {
                const block = await this.getBlockByHash(header.hash);
                this.eventBus.dispatch<Block>(ChainvizEvent.NEW_BLOCK, block);
            },
        );
    }

    subsribeToFinalizedBlocks() {
        if (this.finalizedHeaderSubscription) {
            return;
        }
        this.finalizedHeaderSubscription = this.substrateClient.rpc.chain.subscribeFinalizedHeads(
            async (header) => {
                const block = await this.getBlockByHash(header.hash);
                this.eventBus.dispatch<Block>(ChainvizEvent.NEW_FINALIZED_BLOCK, block);
            },
        );
    }

    async getBlockByHash(hash: BlockHash): Promise<Block> {
        const extendedHeader = await this.substrateClient.derive.chain.getHeader(hash);
        const substrateBlock = (await this.substrateClient.rpc.chain.getBlock(hash)).block;
        const apiAt = await this.substrateClient.at(hash);
        const timestamp = (await apiAt.query.timestamp.now()).toJSON() as number;
        const events = (await apiAt.query.system.events()).toHuman() as AnyJson[];
        const runtimeVersion = await this.substrateClient.rpc.state.getRuntimeVersion(hash);
        const block = new Block(
            extendedHeader,
            substrateBlock,
            timestamp,
            events,
            runtimeVersion.specVersion.toNumber(),
        );
        return block;
    }

    async getBlockByNumber(number: number): Promise<Block> {
        const hash = await this.substrateClient.rpc.chain.getBlockHash(number);
        return this.getBlockByHash(hash);
    }

    async getXCMTransfers(): Promise<XCMInfo[]> {
        const url = 'https://api.polkaholic.io/xcmtransfers';
        const xcmInfoWrapperList: XCMInfoWrapper[] = await (
            await fetch(
                url +
                    '?' +
                    new URLSearchParams({
                        limit: `${Constants.XCM_TRANSFER_FETCH_LIMIT}`,
                    }).toString(),
                {
                    method: 'GET',
                    headers: {},
                },
            )
        ).json();
        const result: XCMInfo[] = [];
        for (const xcmInfoWrapper of xcmInfoWrapperList) {
            if (isXCMInfo(xcmInfoWrapper.xcmInfo)) {
                if (xcmInfoWrapper.xcmInfo.relayChain.relayChain == this.network.id) {
                    result.push(xcmInfoWrapper.xcmInfo);
                }
            }
        }
        return result;
    }

    async disconnectSubstrateClient() {
        if (this.newBlockSubscription) {
            (await this.newBlockSubscription)();
            this.newBlockSubscription = undefined;
        }
        if (this.finalizedHeaderSubscription) {
            (await this.finalizedHeaderSubscription)();
            this.finalizedHeaderSubscription = undefined;
        }
        await this.substrateClient.disconnect();
    }
}

export { DataStore };
