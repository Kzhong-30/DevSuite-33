import { Schema, model, Document, Types } from 'mongoose';

export type AlertEventType = 'enter' | 'exit' | 'offline';

export interface IAlert extends Document {
  geofenceId?: Types.ObjectId;
  deviceId: string;
  type: AlertEventType;
  message: string;
  location?: {
    type: 'Point';
    coordinates: [number, number];
  };
  timestamp: Date;
  read: boolean;
}

const AlertSchema = new Schema<IAlert>({
  geofenceId: {
    type: Schema.Types.ObjectId,
    ref: 'Geofence',
    index: true
  },
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['enter', 'exit', 'offline'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      index: '2dsphere'
    }
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  read: {
    type: Boolean,
    default: false
  }
});

AlertSchema.index({ deviceId: 1, timestamp: -1 });
AlertSchema.index({ geofenceId: 1, timestamp: -1 });
AlertSchema.index({ read: 1, timestamp: -1 });

export const Alert = model<IAlert>('Alert', AlertSchema);
