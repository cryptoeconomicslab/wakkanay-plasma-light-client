import StateManager from '../src/managers/StateManager'
import { KeyValueStore, InMemoryKeyValueStore } from 'wakkanay/dist/db'
import { Range, BigNumber, Bytes, Address } from 'wakkanay/dist/types'
import { StateUpdate } from 'wakkanay-ethereum-plasma'
import { Property } from 'wakkanay/dist/ovm'
import Coder from '../src/Coder'

function su(start: bigint, end: bigint): StateUpdate {
  const property = new Property(
    Address.default(),
    [
      Address.default(),
      new Range(BigNumber.from(start), BigNumber.from(end)).toStruct(),
      BigNumber.from(1),
      new Property(Address.default(), [Bytes.fromHexString('0x01')]).toStruct()
    ].map(Coder.encode)
  )
  return new StateUpdate(property)
}

describe('StateManager', () => {
  let stateManager: StateManager, db: KeyValueStore

  beforeEach(async () => {
    db = new InMemoryKeyValueStore(Bytes.fromString('state'))
    stateManager = new StateManager(db)
  })

  test('resolve state update', async () => {
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(0), BigInt(10))
    )
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(10), BigInt(20))
    )

    const s = await stateManager.resolveStateUpdate(Address.default(), 5)
    if (!s) throw new Error('S is null')

    expect(s).not.toBeNull()
    expect(s.amount).toBe(BigInt(5))
  })

  test('resolve state update to null', async () => {
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(0), BigInt(10))
    )
    await stateManager.insertVerifiedStateUpdate(
      Address.default(),
      su(BigInt(10), BigInt(20))
    )

    const s = await stateManager.resolveStateUpdate(Address.default(), 15)
    expect(s).toBeNull()
  })
})
