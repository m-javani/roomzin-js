// GetRoomDayResult defines the result for retrieving room details for a specific date (GETPROPROOMDAY command).
export type GetRoomDayResult = {
    propertyID: string;
    date: string;
    availability: number;
    finalPrice: number;
    rateFeature: string[];
};

// DayAvail one day inside a property.
export type DayAvail = {
    date: string;
    availability: number;
    finalPrice: number;
    rateFeature: string[];
};

// PropertyAvail one property + all its days.
export type PropertyAvail = {
    propertyID: string;
    days: DayAvail[];
};

export type SegmentInfo = {
    segment: string;
    propCount: number;
};