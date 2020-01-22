import { Checkpoint } from '@cryptoeconomicslab/plasma'
import { Address, Bytes } from '@cryptoeconomicslab/primitives'
import { decodeStructable } from '@cryptoeconomicslab/coder'
import { KeyValueStore } from '@cryptoeconomicslab/db'

export default class CheckpointManager {
  constructor(readonly kvs: KeyValueStore) {}

  private async getBucket(addr: Address): Promise<KeyValueStore> {
    return await this.kvs.bucket(ovmContext.coder.encode(addr))
  }

  public async insertCheckpoint(
    depositContractAddress: Address,
    checkpointId: Bytes,
    checkpoint: Checkpoint
  ) {
    const bucket = await this.getBucket(depositContractAddress)
    await bucket.put(
      checkpointId,
      ovmContext.coder.encode(checkpoint.toStruct())
    )
  }

  public async getCheckpoint(
    depositContractAddress: Address,
    checkpointId: Bytes
  ): Promise<Checkpoint | null> {
    const bucket = await this.getBucket(depositContractAddress)
    const res = await bucket.get(checkpointId)
    if (!res) return null

    return decodeStructable(Checkpoint, ovmContext.coder, res)
  }

  public async removeCheckpoint(
    depositContractAddress: Address,
    checkpointId: Bytes
  ) {
    const bucket = await this.getBucket(depositContractAddress)
    await bucket.del(checkpointId)
  }
}
