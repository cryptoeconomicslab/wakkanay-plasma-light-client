import { types, db } from 'wakkanay-ethereum-plasma'
import KeyValueStore = db.KeyValueStore
import Bytes = types.Bytes
import BigNumber = types.BigNumber
import Coder from '../Coder'

const LATEST_SYNCED_BLOCK = Bytes.fromString('latest_synced_block')

export default class SyncManager {
  constructor(readonly db: KeyValueStore) {}

  public async getLatestSyncedBlockNumber(): Promise<BigNumber> {
    const d = await this.db.get(LATEST_SYNCED_BLOCK)

    if (!d) return BigNumber.from(-1)
    return Coder.decode(BigNumber.default(), d)
  }

  public async getRoot(blockNumber: BigNumber): Promise<Bytes | null> {
    return await this.db.get(Coder.encode(blockNumber))
  }

  /**
   * update synced block number and save root hash of the block
   * @param blockNumber block number to be set as LATEST_SYNCED_BLOCK
   * @param root root hash of the newly synced block
   */
  public async updateSyncedBlockNumber(
    blockNumber: BigNumber,
    root: Bytes
  ): Promise<void> {
    await this.db.put(LATEST_SYNCED_BLOCK, Coder.encode(blockNumber))
    await this.db.put(Coder.encode(blockNumber), root)
  }
}
