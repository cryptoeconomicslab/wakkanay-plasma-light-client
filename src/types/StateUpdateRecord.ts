import { Address, Struct, BigNumber } from 'wakkanay/dist/types'
import { Property } from 'wakkanay/dist/ovm'

export default class StateUpdateRecord {
  constructor(
    readonly predicateAddress: Address,
    readonly depositContractAddress: Address,
    readonly blockNumber: BigNumber,
    readonly stateObject: Property
  ) {}

  /**
   * return empty instance of Transaction
   */
  public static default(): StateUpdateRecord {
    return new StateUpdateRecord(
      Address.default(),
      Address.default(),
      BigNumber.default(),
      new Property(Address.default(), [])
    )
  }

  public static getParamType(): Struct {
    return new Struct({
      predicateAddress: Address.default(),
      depositContractAddress: Address.default(),
      blockNumber: BigNumber.default(),
      stateObject: Property.getParamType()
    })
  }

  public static fromStruct(struct: Struct): StateUpdateRecord {
    const {
      predicateAddress,
      blockNumber,
      depositContractAddress,
      stateObject
    } = struct.data

    return new StateUpdateRecord(
      predicateAddress as Address,
      depositContractAddress as Address,
      blockNumber as BigNumber,
      Property.fromStruct(stateObject as Struct)
    )
  }

  public toStruct(): Struct {
    return new Struct({
      predicateAddress: this.predicateAddress,
      depositContractAddress: this.depositContractAddress,
      blockNumber: this.blockNumber,
      stateObject: this.stateObject.toStruct()
    })
  }
}
