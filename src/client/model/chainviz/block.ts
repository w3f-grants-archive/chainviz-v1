import { HeaderExtended } from '@polkadot/api-derive/types';
import { AccountId, Block as SubstrateBlock } from '@polkadot/types/interfaces';
import { AnyJson } from '@polkadot/types/types';

class Block {
    readonly extendedHeader: HeaderExtended;
    readonly block: SubstrateBlock;
    readonly authorAccountId?: AccountId;
    private authorDisplay?: string;
    readonly time: Date;
    readonly events: AnyJson[];
    readonly runtimeVersion: number;

    constructor(
        extendedHeader: HeaderExtended,
        block: SubstrateBlock,
        timestampMs: number,
        events: AnyJson[],
        runtimeVersion: number,
    ) {
        this.extendedHeader = extendedHeader;
        this.authorAccountId = extendedHeader.author;
        this.block = block;
        this.time = new Date(timestampMs);
        this.events = events;
        this.runtimeVersion = runtimeVersion;
    }

    setAuthorDisplay(display?: string) {
        this.authorDisplay = display;
    }

    getAuthorDisplay(): string | undefined {
        return this.authorDisplay;
    }
}

export { Block };
