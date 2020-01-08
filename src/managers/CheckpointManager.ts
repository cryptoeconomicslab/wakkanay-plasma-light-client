import { types, db, Checkpoint, utils } from 'wakkanay-ethereum-plasma'
import Address = types.Address
import Bytes = types.Bytes
import KeyValueStore = db.KeyValueStore
import DecoderUtil = utils.DecoderUtil

import Coder from '../Coder'

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
