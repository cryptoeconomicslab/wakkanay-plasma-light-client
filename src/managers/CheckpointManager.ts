import { KeyValueStore } from 'wakkanay/dist/db'
import { Address, Bytes } from 'wakkanay/dist/types'
import Coder from '../Coder'
import { DecoderUtil } from 'wakkanay/dist/utils'
import { Checkpoint } from 'wakkanay-ethereum-plasma/dist/types'

export default class CheckpointManager {
  constructor(readonly kvs: KeyValueStore) {}

  private async getBucket(addr: Address): Promise<KeyValueStore> {
    return await this.kvs.bucket(Coder.encode(addr))
  }

  public async insertCheckpoint(
    depositContractAddress: Address,
    checkpointId: Bytes,
    checkpoint: Checkpoint
  ) {
    const bucket = await this.getBucket(depositContractAddress)
    await bucket.put(checkpointId, Coder.encode(checkpoint.toStruct()))
  }

  public async getCheckpoint(
    depositContractAddress: Address,
    checkpointId: Bytes
  ): Promise<Checkpoint | null> {
    const bucket = await this.getBucket(depositContractAddress)
    const res = await bucket.get(checkpointId)
    if (!res) return null

    return DecoderUtil.decodeStructable(Checkpoint, Coder, res)
  }

  public async removeCheckpoint(
    depositContractAddress: Address,
    checkpointId: Bytes
  ) {
    const bucket = await this.getBucket(depositContractAddress)
    await bucket.del(checkpointId)
  }
}
