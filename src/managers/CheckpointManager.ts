import { KeyValueStore } from 'wakkanay/dist/db'
import { Property } from 'wakkanay/dist/ovm'
import { Bytes } from 'wakkanay/dist/types'
import Coder from '../Coder'
import { DecoderUtil } from 'wakkanay/dist/utils'

const kind = {
  verified: Bytes.fromString('verified'),
  pending: Bytes.fromString('pending')
}

export default class CheckpointManager {
  constructor(readonly kvs: KeyValueStore) {}

  public async insertCheckpoint(checkpointId: Bytes, checkpoint: Property) {
    const bucket = await this.kvs.bucket(kind.verified)
    await bucket.put(checkpointId, Coder.encode(checkpoint.toStruct()))
  }

  public async getCheckpoint(checkpointId: Bytes): Promise<Property | null> {
    const bucket = await this.kvs.bucket(kind.verified)
    const res = await bucket.get(checkpointId)
    if (!res) return null

    return DecoderUtil.decodeStructable(Property, Coder, res)
  }

  public async removeCheckpoint(checkpointId: Bytes) {
    const bucket = await this.kvs.bucket(kind.verified)
    await bucket.del(checkpointId)
  }
}
