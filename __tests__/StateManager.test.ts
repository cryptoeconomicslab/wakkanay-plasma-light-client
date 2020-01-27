import StateManager from '../src/managers/StateManager'
import { StateUpdate } from '@cryptoeconomicslab/plasma'

import { KeyValueStore } from '@cryptoeconomicslab/db'
import { IndexedDbKeyValueStore } from '@cryptoeconomicslab/indexeddb-kvs'

import {
  Range,
  Bytes,
  BigNumber,
  Address
} from '@cryptoeconomicslab/primitives'
import { Property } from '@cryptoeconomicslab/ovm'
import { setupContext } from '@cryptoeconomicslab/context'
import JsonCoder from '@cryptoeconomicslab/coder'
import 'fake-indexeddb/auto'
setupContext({
  coder: JsonCoder
})

function su(start: bigint, end: bigint): StateUpdate {
  const property = new Property(
    Address.default(),
    [
      Address.default(),
      new Range(BigNumber.from(start), BigNumber.from(end)).toStruct(),
      BigNumber.from(1),
      new Property(Address.default(), [Bytes.fromHexString('0x01')]).toStruct()
    ].map(ovmContext.coder.encode)
  )
  return StateUpdate.fromProperty(property)
}

describe('StateManager', () => {
  let stateManager: StateManager, db: KeyValueStore

  beforeEach(async () => {
    db = new IndexedDbKeyValueStore(Bytes.fromString('state'))
    stateManager = new StateManager(db)
  })

  test('resolve state update with single state update', async () => {
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(0), BigInt(10))
    )
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(10), BigInt(20))
    )

    const s = await stateManager.resolveStateUpdate(Address.default(), 5)
    expect(s).toEqual([su(BigInt(0), BigInt(5))])
  })

  test('resolve state update with multiple state updates', async () => {
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(0), BigInt(10))
    )
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(10), BigInt(20))
    )

    const resolvedStateUpdates = await stateManager.resolveStateUpdate(
      Address.default(),
      15
    )

    if (!resolvedStateUpdates) throw new Error('resolvedStateUpdates is null')
    expect(resolvedStateUpdates).toEqual([
      su(BigInt(0), BigInt(10)),
      su(BigInt(10), BigInt(15))
    ])
  })

  test('resolve state update to be null', async () => {
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(0), BigInt(10))
    )
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(10), BigInt(20))
    )

    const resolvedStateUpdates = await stateManager.resolveStateUpdate(
      Address.default(),
      25
    )
    expect(resolvedStateUpdates).toBeNull()
  })
})
