import SyncManager from '../src/managers/SyncManager'
import { KeyValueStore } from '@cryptoeconomicslab/db'
import { IndexedDbKeyValueStore } from '@cryptoeconomicslab/indexeddb-kvs'
import { Bytes, BigNumber } from '@cryptoeconomicslab/primitives'
import { setupContext } from '@cryptoeconomicslab/context'
import JsonCoder from '@cryptoeconomicslab/coder'
import 'fake-indexeddb/auto'
setupContext({ coder: JsonCoder })

describe('SyncManager', () => {
  let syncManager: SyncManager, db: KeyValueStore

  beforeEach(async () => {
    db = new IndexedDbKeyValueStore(Bytes.fromString('sync'))
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
