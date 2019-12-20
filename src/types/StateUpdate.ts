import { Address, Bytes, BigNumber, Range } from 'wakkanay/dist/types'
import { Property } from 'wakkanay/dist/ovm'
import StateUpdateRecord from './StateUpdateRecord'
import Coder from '../Coder'
import { DecoderUtil } from 'wakkanay/dist/utils'

/**
 * StateUpdate wrapper class
 * StateUpdate is a property with inputs type
 * [tokenAddress: Address, range: Range, block_number: uint256, stateObject: Property]
 */
export default class StateUpdate {
  public depositContractAddress: Address
  public range: Range
  public blockNumber: BigNumber
  public stateObject: Property

  constructor(public property: Property) {
    this.depositContractAddress = Coder.decode(
      Address.default(),
      property.inputs[0]
    )
    this.range = DecoderUtil.decodeStructable(Range, Coder, property.inputs[1])
    this.blockNumber = Coder.decode(BigNumber.default(), property.inputs[2])
    this.stateObject = DecoderUtil.decodeStructable(
      Property,
      Coder,
      property.inputs[3]
    )
  }

  public get predicateAddress(): Address {
    return this.property.deciderAddress
  }

  public update({
    depositContractAddress,
    range,
    blockNumber,
    stateObject
  }: {
    depositContractAddress?: Address
    range?: Range
    blockNumber?: BigNumber
    stateObject?: Property
  }) {
    const property = this.property
    if (depositContractAddress) {
      this.depositContractAddress = depositContractAddress
      property.inputs[0] = Coder.encode(depositContractAddress)
    }
    if (range) {
      this.range = range
      property.inputs[1] = Coder.encode(range.toStruct())
    }
    if (blockNumber) {
      this.blockNumber = blockNumber
      property.inputs[2] = Coder.encode(blockNumber)
    }
    if (stateObject) {
      this.stateObject = stateObject
      property.inputs[3] = Coder.encode(stateObject.toStruct())
    }
  }

  public static fromRecord(
    record: StateUpdateRecord,
    range: Range
  ): StateUpdate {
    const inputs: Bytes[] = [
      record.depositContractAddress,
      range.toStruct(),
      record.blockNumber,
      record.stateObject.toStruct()
    ].map(Coder.encode)

    const property = new Property(record.predicateAddress, inputs)

    return new StateUpdate(property)
  }

  public toRecord(): StateUpdateRecord {
    return new StateUpdateRecord(
      this.property.deciderAddress,
      this.depositContractAddress,
      this.blockNumber,
      this.stateObject
    )
  }

  public isOwnershipState(): boolean {
    const thereExistsAddress = Address.from(
      process.env.THERE_EXISTS_ADDRESS as string
    )
    const isValidSigAddress = Address.from(
      process.env.IS_VALID_SIG_ADDRESS as string
    )

    let inner = this.stateObject
    if (inner.deciderAddress.data !== thereExistsAddress.data) return false
    inner = DecoderUtil.decodeStructable(Property, Coder, inner.inputs[2])
    if (inner.deciderAddress.data !== thereExistsAddress.data) return false
    inner = DecoderUtil.decodeStructable(Property, Coder, inner.inputs[2])
    if (inner.deciderAddress.data !== isValidSigAddress.data) return false

    return true
  }

  public getOwner(): Address | undefined {
    const thereExistsAddress = Address.from(
      process.env.THERE_EXISTS_ADDRESS as string
    )
    const isValidSigAddress = Address.from(
      process.env.IS_VALID_SIG_ADDRESS as string
    )

    let inner = this.stateObject
    if (inner.deciderAddress.data !== thereExistsAddress.data) return
    inner = DecoderUtil.decodeStructable(Property, Coder, inner.inputs[2])
    if (inner.deciderAddress.data !== thereExistsAddress.data) return
    inner = DecoderUtil.decodeStructable(Property, Coder, inner.inputs[2])
    if (inner.deciderAddress.data !== isValidSigAddress.data) return
    return Coder.decode(Address.default(), inner.inputs[2])
  }
}
