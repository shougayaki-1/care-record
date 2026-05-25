export type Report = {
    id: string; 
    start_at: string; 
    status: 'pending' | 'approved' | 'remanded';
    client_id: string; 
    clients: { name: string; } | null;
};