import SyncManager from '../src/managers/SyncManager'
import { types, db } from 'wakkanay-ethereum-plasma'
import KeyValueStore = db.KeyValueStore
import InMemoryKeyValueStore = db.InMemoryKeyValueStore
import Bytes = types.Bytes
import BigNumber = types.BigNumber

describe('SyncManager', () => {
  let syncManager: SyncManager, db: KeyValueStore

  beforeEach(async () => {
    db = new InMemoryKeyValueStore(Bytes.fromString('sync'))
    syncManager = new SyncManager(db)
  })

  test('get and update', async () => {
    let blockNumber = await syncManager.getLatestSyncedBlockNumber()
    expect(blockNumber).toEqual(BigNumber.from(-1))
    syncManager.updateSyncedBlockNumber(BigNumber.from(3), Bytes.default())
    blockNumber = await syncManager.getLatestSyncedBlockNumber()
    expect(blockNumber).toEqual(BigNumber.from(3))
  })
})
