import { KeyValueStore } from 'wakkanay/dist/db'
import { BigNumber, Bytes } from 'wakkanay/dist/types'
import Coder from '../Coder'

const LATEST_SYNCED_BLOCK = Bytes.fromString('latest_synced_block')

export default class SyncManager {
  constructor(readonly db: KeyValueStore) {}

  public async getLatestSyncedBlockNumber(): Promise<BigNumber> {
    const d = await this.db.get(LATEST_SYNCED_BLOCK)

    if (!d) return BigNumber.from(-1)
    return Coder.decode(BigNumber.default(), d)
  }

  public async updateSyncedBlockNumber(blockNumber: BigNumber): Promise<void> {
    this.db.put(LATEST_SYNCED_BLOCK, Coder.encode(blockNumber))
  }
}
