import { Schema, model, Document } from 'mongoose';

export interface ILocation extends Document {
  deviceId: string;
  longitude: number;
  latitude: number;
  altitude: number;
  speed: number;
  direction: number;
  timestamp: Date;
  coordinates: {
    type: 'Point';
    coordinates: [number, number];
  };
}

const LocationSchema = new Schema<ILocation>({
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  longitude: {
    type: Number,
    required: true,
    min: -180,
    max: 180
  },
  latitude: {
    type: Number,
    required: true,
    min: -90,
    max: 90
  },
  altitude: {
    type: Number,
    default: 0
  },
  speed: {
    type: Number,
    default: 0
  },
  direction: {
    type: Number,
    default: 0,
    min: 0,
    max: 360
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true,
      index: '2dsphere'
    }
  }
});

LocationSchema.index({ deviceId: 1, timestamp: -1 });
LocationSchema.index({ coordinates: '2dsphere' });

LocationSchema.pre<ILocation>('validate', function (next) {
  if (!this.coordinates || !this.coordinates.coordinates) {
    this.coordinates = {
      type: 'Point',
      coordinates: [this.longitude, this.latitude]
    };
  }
  next();
});

export const Location = model<ILocation>('Location', LocationSchema);
