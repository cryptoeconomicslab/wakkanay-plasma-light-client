import SyncManager from '../src/managers/SyncManager'
import { KeyValueStore, InMemoryKeyValueStore } from 'wakkanay/dist/db'
import { Bytes, BigNumber } from 'wakkanay/dist/types/Codables'

describe('SyncManager', () => {
  let syncManager: SyncManager, db: KeyValueStore

  beforeEach(async () => {
    db = new InMemoryKeyValueStore(Bytes.fromString('sync'))
    syncManager = new SyncManager(db)
  })

  test('get and update', async () => {
    let blockNumber = await syncManager.getLatestSyncedBlockNumber()
    expect(blockNumber).toEqual(BigNumber.from(0))
    syncManager.updateSyncedBlockNumber(BigNumber.from(3))
    blockNumber = await syncManager.getLatestSyncedBlockNumber()
    expect(blockNumber).toEqual(BigNumber.from(3))
  })
})
