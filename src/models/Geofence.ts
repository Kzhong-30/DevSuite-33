import { Schema, model, Document } from 'mongoose';

export type GeofenceType = 'circle' | 'polygon';
export type AlertType = 'enter' | 'exit';

export interface ICircularGeofence {
  type: 'circle';
  center: {
    type: 'Point';
    coordinates: [number, number];
  };
  radius: number;
}

export interface IPolygonGeofence {
  type: 'polygon';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface IGeofence extends Document {
  name: string;
  description?: string;
  geofenceType: GeofenceType;
  circular?: ICircularGeofence;
  polygon?: IPolygonGeofence;
  alerts: AlertType[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CircularGeofenceSchema = new Schema<ICircularGeofence>({
  type: {
    type: String,
    enum: ['circle'],
    required: true,
    default: 'circle'
  },
  center: {
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
  },
  radius: {
    type: Number,
    required: true,
    min: 1
  }
});

const PolygonGeofenceSchema = new Schema<IPolygonGeofence>({
  type: {
    type: String,
    enum: ['polygon'],
    required: true,
    default: 'polygon'
  },
  geometry: {
    type: {
      type: String,
      enum: ['Polygon'],
      required: true,
      default: 'Polygon'
    },
    coordinates: {
      type: [[[Number]]],
      required: true,
    }
  }
});

const GeofenceSchema = new Schema<IGeofence>(
  {
    name: {
      type: String,
      required: true
    },
    description: {
      type: String
    },
    geofenceType: {
      type: String,
      enum: ['circle', 'polygon'],
      required: true
    },
    circular: {
      type: CircularGeofenceSchema
    },
    polygon: {
      type: PolygonGeofenceSchema
    },
    alerts: {
      type: [String],
      enum: ['enter', 'exit'],
      required: true,
      default: ['enter', 'exit']
    },
    enabled: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

GeofenceSchema.index({ enabled: 1 });

export const Geofence = model<IGeofence>('Geofence', GeofenceSchema);
