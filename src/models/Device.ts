import { Schema, model, Document } from 'mongoose';

export interface IDevice extends Document {
  deviceId: string;
  name: string;
  type: string;
  deviceToken: string;
  status: 'online' | 'offline';
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceSchema = new Schema<IDevice>(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    name: {
      type: String,
      required: true
    },
    type: {
      type: String,
      default: 'truck'
    },
    deviceToken: {
      type: String,
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['online', 'offline'],
      default: 'offline'
    },
    lastSeen: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

DeviceSchema.index({ status: 1 });
DeviceSchema.index({ lastSeen: -1 });

export const Device = model<IDevice>('Device', DeviceSchema);
