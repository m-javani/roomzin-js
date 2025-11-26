import { validateRateFeatures } from './codecs';

export function validateDate(date: string): [boolean, string] {
    const errors: string[] = [];

    // Check format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push(`invalid date format: ${date}, expected YYYY-MM-DD`);
    } else {
        // Parse to ensure valid date
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
            errors.push(`invalid date: ${date}`);
        } else {
            // Check if date is in the past
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (parsedDate < today) {
                errors.push(`date ${date} is in the past`);
            }

            // Check if date is beyond 365 days
            const oneYearFromNow = new Date();
            oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

            if (parsedDate > oneYearFromNow) {
                errors.push(`date ${date} is beyond 365 days from today`);
            }
        }
    }

    if (errors.length > 0) {
        return [false, errors.join("; ")];
    }
    return [true, ""];
}

export function validateDates(dates: string[]): [boolean, string] {
    const errors: string[] = [];
    for (const date of dates) {
        const [valid, err] = validateDate(date);
        if (!valid) {
            errors.push(err);
        }
    }
    if (errors.length > 0) {
        return [false, "Date errors: " + errors.join("; ")];
    }
    return [true, ""];
}

// LoginPayload defines the payload for the AUTH command.
export type LoginPayload = {
    token: string; // Static token for authentication (optional)
}

export function verifyLoginPayload(p: LoginPayload): [boolean, string] {
    if (!p.token) {
        return [false, "token is required"];
    }
    return [true, ""];
}

// SetPropPayload defines the payload for adding a new property (ADDPROP command).
export type SetPropPayload = {
    segment: string;
    area: string;
    propertyID: string;
    propertyType: string;
    category: string;
    stars: number;
    latitude: number;
    longitude: number;
    amenities: string[];
}

export function verifySetPropPayload(p: SetPropPayload, codecs: any): [boolean, string] {
    const errors: string[] = [];

    if (!p.segment) errors.push("segment is required");
    if (!p.area) errors.push("area is required");
    if (!p.propertyID) errors.push("propertyID is required");
    if (!p.propertyType) errors.push("propertyType is required");
    if (!p.category) errors.push("category is required");
    if (p.stars === 0 || p.stars > 5) errors.push("stars must be between 1 and 5");
    if (p.latitude < -90 || p.latitude > 90) errors.push("latitude must be between -90 and 90");
    if (p.longitude < -180 || p.longitude > 180) errors.push("longitude must be between -180 and 180");

    if (errors.length > 0) return [false, errors.join("; ")];
    return [true, ""];
}

// PropRoomExistPayload defines the payload for checking if a property has a specific room type (PROPROOMEXIST command).
export type PropRoomExistPayload = {
    propertyID: string;
    roomType: string;
}

// DelPropRoomPayload defines the payload for deleting a room type from a property (DELPROPROOM command).
export type DelPropRoomPayload = {
    propertyID: string;
    roomType: string;
}

// PropRoomDateListPayload defines the payload for listing dates with availability for a room type (PROPROOMDATELIST command).
export type PropRoomDateListPayload = {
    propertyID: string;
    roomType: string;
}

// DelRoomDayRequest defines the payload for deleting a room's data for a specific date (DELROOMDAY command).
export type DelRoomDayRequest = {
    propertyID: string;
    roomType: string;
    date: string; // YYYY-MM-DD
}

export function verifyDelRoomDayRequest(p: DelRoomDayRequest): [boolean, string] {
    const errors: string[] = [];
    if (!p.propertyID?.trim()) errors.push('propertyID is required');
    if (!p.roomType?.trim()) errors.push('roomType is required');
    const [valid, errMsg] = validateDate(p.date);
    if (!valid) errors.push(errMsg);
    if (errors.length > 0) return [false, errors.join("; ")];
    return [true, ""];
}

// UpdRoomAvlPayload defines the payload for updating room availability (INCROOMAVL, DECROOMAVL, SETROOMAVL commands).
export type UpdRoomAvlPayload = {
    propertyID: string;
    roomType: string;
    date: string; // YYYY-MM-DD
    amount: number;
}

export function verifyUpdRoomAvlPayload(p: UpdRoomAvlPayload): [boolean, string] {
    const errors: string[] = [];

    if (!p.propertyID) errors.push("propertyID is required");
    if (!p.roomType) errors.push("roomType is required");
    if (p.amount === 0) errors.push("amount must be greater than 0");

    const [valid, err] = validateDate(p.date);
    if (!valid) errors.push(err);

    if (errors.length > 0) return [false, errors.join("; ")];
    return [true, ""];
}

// SetRoomPkgPayload defines the payload for setting room availability, pricing, and cancellation policy (SETROOMPKG command).
export type SetRoomPkgPayload = {
    propertyID: string;
    roomType: string;
    date: string; // YYYY-MM-DD
    availability?: number;
    finalPrice?: number;
    rateFeature: string[]; // Optional; empty array if not provided
}

export function verifySetRoomPkgPayload(p: SetRoomPkgPayload, codecs: any): [boolean, string] {
    const errors: string[] = [];

    if (!p.propertyID) errors.push("propertyID is required");
    if (!p.roomType) errors.push("roomType is required");

    const [validDate, dateErr] = validateDate(p.date);
    if (!validDate) errors.push(dateErr);

    if (p.rateFeature.length > 0) {
        const [ok, err] = validateRateFeatures(codecs, p.rateFeature);
        if (!ok) errors.push(err);
    }

    if (errors.length > 0) return [false, errors.join("; ")];
    return [true, ""];
}

// GetRoomDayRequest defines the payload for retrieving room details for a specific date (GETPROPROOMDAY command).
export type GetRoomDayRequest = {
    propertyID: string;
    roomType: string;
    date: string; // YYYY-MM-DD
}

export function verifyGetRoomDayRequest(p: GetRoomDayRequest): [boolean, string] {
    const errors: string[] = [];

    if (!p.propertyID) errors.push("propertyID is required");
    if (!p.roomType) errors.push("roomType is required");
    const [valid, err] = validateDate(p.date);
    if (!valid) errors.push(err);

    if (errors.length > 0) return [false, errors.join("; ")];
    return [true, ""];
}

export type SearchPropPayload = {
    segment: string;
    area?: string;
    type?: string;
    stars?: number;
    category?: string;
    amenities?: string[];
    longitude?: number;
    latitude?: number;
    limit?: number;
}

export function verifySearchPropPayload(p: SearchPropPayload, codecs: any): [boolean, string] {
    const errors: string[] = [];

    if (!p.segment) errors.push("segment is required");
    if (p.stars && (p.stars === 0 || p.stars > 5)) errors.push("stars must be 1–5");
    if (p.latitude && (p.latitude < -90 || p.latitude > 90)) errors.push("latitude must be between -90 and 90");
    if (p.longitude && (p.longitude < -180 || p.longitude > 180)) errors.push("longitude must be between -180 and 180");

    if (errors.length > 0) return [false, errors.join("; ")];
    return [true, ""];
}

export type SearchAvailPayload = {
    segment: string;
    roomType: string;
    area?: string;
    propertyID?: string;
    type?: string;
    stars?: number;
    category?: string;
    amenities: string[];
    longitude?: number;
    latitude?: number;
    date: string[];
    availability?: number;
    finalPrice?: number;
    rateFeature: string[];
    limit?: number;
}

export function verifySearchAvailPayload(p: SearchAvailPayload, codecs: any): [boolean, string] {
    const errors: string[] = [];

    if (!p.segment) errors.push("segment is required");
    if (!p.roomType) errors.push("roomType is required");
    if (p.latitude && (p.latitude < -90 || p.latitude > 90)) errors.push("latitude must be between -90 and 90");
    if (p.longitude && (p.longitude < -180 || p.longitude > 180)) errors.push("longitude must be between -180 and 180");
    if (p.date.length === 0) errors.push("at least one date is required");

    const [validDates, datesErr] = validateDates(p.date);
    if (!validDates) errors.push(datesErr);

    if (p.rateFeature.length > 0) {
        const [ok, err] = validateRateFeatures(codecs, p.rateFeature);
        if (!ok) errors.push(err);
    }

    if (p.limit && p.limit === 0) errors.push("limit must be greater than 0");

    if (errors.length > 0) return [false, errors.join("; ")];
    return [true, ""];
}

// DelPropDayRequest defines the payload for deleting all room data for a property on a specific date (DELPROPDAY command).
export type DelPropDayRequest = {
    propertyID: string;
    date: string; // YYYY-MM-DD
}

export function verifyDelPropDayRequest(p: DelPropDayRequest): [boolean, string] {
    if (!p.propertyID) return [false, "propertyID is required"];
    return validateDate(p.date);
}

module.exports = {
    // Validation functions
    validateDate,
    validateDates,

    // Verification functions
    verifyLoginPayload,
    verifySetPropPayload,
    verifyDelRoomDayRequest,
    verifyUpdRoomAvlPayload,
    verifySetRoomPkgPayload,
    verifyGetRoomDayRequest,
    verifySearchPropPayload,
    verifySearchAvailPayload,
    verifyDelPropDayRequest,
};