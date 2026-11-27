// The root googleapis entry loads every generated API. Import only the APIs we
// use and the same AuthPlus implementation to keep unrelated APIs out of bundles.
import { auth, calendar } from 'googleapis/build/src/apis/calendar';
import { logging } from 'googleapis/build/src/apis/logging';

export const google = { auth, calendar, logging };
export type { calendar_v3 } from 'googleapis/build/src/apis/calendar';
