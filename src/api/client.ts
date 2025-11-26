import type {
    PropertyAvail,
    GetRoomDayResult,
    SegmentInfo,
} from '../types/response';

import type {
    Codecs,
} from '../types/codecs';

import type {
    SetPropPayload,
    SearchPropPayload,
    SearchAvailPayload,
    SetRoomPkgPayload,
    UpdRoomAvlPayload,
    PropRoomExistPayload,
    PropRoomDateListPayload,
    DelPropDayRequest,
    DelPropRoomPayload,
    DelRoomDayRequest,
    GetRoomDayRequest,
} from '../types/request';

export interface CacheClientAPI {
    /**
     * Returns the current codec registry (field IDs, compression, etc.)
     */
    getCodecs(): Promise<Codecs>;

    /**
     * Set property metadata
     */
    setProp(p: SetPropPayload): Promise<void>;

    /**
     * Search properties by filters
     */
    searchProp(p: SearchPropPayload): Promise<string[]>;

    /**
     * Search availability across properties/dates
     */
    searchAvail(p: SearchAvailPayload): Promise<PropertyAvail[]>;

    /**
     * Assign a package/pricing to a room type
     */
    setRoomPkg(p: SetRoomPkgPayload): Promise<void>;

    /**
     * Absolute set of room availability
     */
    setRoomAvl(p: UpdRoomAvlPayload): Promise<number>; // returns uint8

    /**
     * Increment room availability (e.g. on cancellation)
     */
    incRoomAvl(p: UpdRoomAvlPayload): Promise<number>;

    /**
     * Decrement room availability (e.g. on booking)
     */
    decRoomAvl(p: UpdRoomAvlPayload): Promise<number>;

    /**
     * Check if property exists
     */
    propExist(propertyID: string): Promise<boolean>;

    /**
     * Check if specific room type exists in property
     */
    propRoomExist(p: PropRoomExistPayload): Promise<boolean>;

    /**
     * List all room type IDs for a property
     */
    propRoomList(propertyID: string): Promise<string[]>;

    /**
     * List dates that have availability data for a property+room
     */
    propRoomDateList(p: PropRoomDateListPayload): Promise<string[]>;

    /**
     * Delete entire property
     */
    delProp(propertyID: string): Promise<void>;

    /**
     * Delete a segment (rate plan, channel, etc.)
     */
    delSegment(segment: string): Promise<void>;

    /**
     * Delete all data for a property on a specific date
     */
    delPropDay(p: DelPropDayRequest): Promise<void>;

    /**
     * Delete a room type from a property
     */
    delPropRoom(p: DelPropRoomPayload): Promise<void>;

    /**
     * Delete availability for a specific room+date
     */
    delRoomDay(p: DelRoomDayRequest): Promise<void>;

    /**
     * Get availability & pricing for a specific room+date
     */
    getPropRoomDay(p: GetRoomDayRequest): Promise<GetRoomDayResult>;

    /**
     * List all active segments
     */
    getSegments(): Promise<SegmentInfo[]>;

    /**
     * Close connection and release resources
     */
    close(): Promise<void>;
}