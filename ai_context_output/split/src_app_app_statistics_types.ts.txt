export interface ShiftStaffData {
    staff_id: string;
    staffs: { name: string } | null;
}

export interface ShiftData { 
    id: string; 
    start_at: string; 
    end_at: string; 
    status: string; 
    client_id: string; 
    clients: { name: string } | null; 
    shift_staffs: ShiftStaffData[]; 
}

export interface ReportData { 
    id: string; 
    start_at: string; 
    end_at: string; 
    status: string; 
    client_id: string; 
    clients: { name: string } | null; 
    helper?: { name: string } | null;
    report_values: { data: { _helpers?: string[]; service_time?: string|number; travel_time?: string|number; } }[] | null; 
}

export interface AggregatedRow { 
    name: string; 
    plannedHours: number; 
    actualHours: number; 
}