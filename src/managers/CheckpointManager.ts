import { KeyValueStore } from 'wakkanay/dist/db'
import { Bytes } from 'wakkanay/dist/types'
import Coder from '../Coder'
import { DecoderUtil } from 'wakkanay/dist/utils'
import { Checkpoint } from 'wakkanay-ethereum-plasma/dist/types'

const kind = {
  verified: Bytes.fromString('verified'),
  pending: Bytes.fromString('pending')
}

export default class CheckpointManager {
  constructor(readonly kvs: KeyValueStore) {}

  public async insertCheckpoint(checkpointId: Bytes, checkpoint: Checkpoint) {
    const bucket = await this.kvs.bucket(kind.verified)
    await bucket.put(checkpointId, Coder.encode(checkpoint.toStruct()))
  }

  public async getCheckpoint(checkpointId: Bytes): Promise<Checkpoint | null> {
    const bucket = await this.kvs.bucket(kind.verified)
    const res = await bucket.get(checkpointId)
    if (!res) return null

    return DecoderUtil.decodeStructable(Checkpoint, Coder, res)
  }

  public async removeCheckpoint(checkpointId: Bytes) {
    const bucket = await this.kvs.bucket(kind.verified)
    await bucket.del(checkpointId)
  }
}
