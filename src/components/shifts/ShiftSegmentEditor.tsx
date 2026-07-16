'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Box, Stack, Button, CircularProgress, Alert, Typography,
  IconButton, Tooltip, Select, MenuItem, FormControl, InputLabel, Chip,
} from '@/components/ui/mui';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { getShiftSegments, saveShiftSegments, type ShiftSegment, type SaveSegmentInput } from '@/app/actions/shiftSegments';
import { getServiceTypes, type ServiceType } from '@/app/actions/serviceTypes';
import { getStaffRoles, type StaffRole } from '@/app/actions/staffRoles';
import { DateTimeField } from '@/components/ui';

type StaffData = { id: string; name: string };

type SegmentDraft = {
  id?: string;
  service_type_id: string;
  start_at: string;
  end_at: string;
  staffs: { staff_id: string; staff_role_id: string }[];
};

const formatDatetimeLocal = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type Props = {
  orgId: string;
  shiftId: string;
  shiftStartAt: string;
  shiftEndAt: string;
  allStaffs: StaffData[];
};

export default function ShiftSegmentEditor({ orgId, shiftId, shiftStartAt, shiftEndAt, allStaffs }: Props) {
  const [segments, setSegments] = useState<SegmentDraft[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [staffRoles, setStaffRoles] = useState<StaffRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [segs, types, roles] = await Promise.all([
        getShiftSegments(orgId, shiftId),
        getServiceTypes(orgId),
        getStaffRoles(orgId),
      ]);
      setSegments(segs.map((s: ShiftSegment) => ({
        id: s.id,
        service_type_id: s.service_type_id ?? '',
        start_at: formatDatetimeLocal(s.start_at),
        end_at: formatDatetimeLocal(s.end_at),
        staffs: s.shift_segment_staffs.map(ss => ({
          staff_id: ss.staff_id,
          staff_role_id: ss.staff_role_id ?? '',
        })),
      })));
      setServiceTypes(types.filter(t => t.is_active));
      setStaffRoles(roles.filter(r => r.is_active));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [orgId, shiftId]);

  useEffect(() => {
    queueMicrotask(() => void loadData());
  }, [loadData]);

  const addSegment = () => {
    setSegments(prev => [
      ...prev,
      {
        service_type_id: '',
        start_at: prev.length > 0 ? prev[prev.length - 1].end_at : formatDatetimeLocal(shiftStartAt),
        end_at: formatDatetimeLocal(shiftEndAt),
        staffs: [],
      },
    ]);
    setDirty(true);
  };

  const removeSegment = (idx: number) => {
    setSegments(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const updateSegment = (idx: number, patch: Partial<SegmentDraft>) => {
    setSegments(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const input: SaveSegmentInput[] = segments.map((s, i) => ({
        service_type_id: s.service_type_id || null,
        start_at: new Date(s.start_at).toISOString(),
        end_at: new Date(s.end_at).toISOString(),
        sort_order: i,
        staffs: s.staffs.map(ss => ({
          staff_id: ss.staff_id,
          staff_role_id: ss.staff_role_id || null,
        })),
      }));
      await saveShiftSegments(orgId, shiftId, input);
      setDirty(false);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Box py={2} textAlign="center"><CircularProgress size={20} /></Box>;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

      {serviceTypes.length === 0 && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          サービス種別が未設定です。事業所設定から追加してください。
        </Alert>
      )}

      <Stack spacing={2}>
        {segments.map((seg, idx) => (
          <Box
            key={idx}
            sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              bgcolor: 'background.subtle',
              position: 'relative',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
              <Typography variant="subtitle2" fontWeight="bold">
                区間 {idx + 1}
              </Typography>
              <Tooltip title="この区間を削除">
                <IconButton size="small" color="error" onClick={() => removeSegment(idx)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>

            <Stack spacing={1.5}>
              <FormControl fullWidth size="small">
                <InputLabel>サービス種別</InputLabel>
                <Select
                  label="サービス種別"
                  value={seg.service_type_id}
                  onChange={(e) => updateSegment(idx, { service_type_id: e.target.value })}
                >
                  <MenuItem value=""><em>未設定</em></MenuItem>
                  {serviceTypes.map(t => (
                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <DateTimeField
                  label="開始日時"
                  fullWidth
                  size="small"
                  value={seg.start_at}
                  onChange={(e) => updateSegment(idx, { start_at: e.target.value })}
                />
                <DateTimeField
                  label="終了日時"
                  fullWidth
                  size="small"
                  value={seg.end_at}
                  onChange={(e) => updateSegment(idx, { end_at: e.target.value })}
                />
              </Stack>

              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  スタッフと役割
                </Typography>
                <Stack spacing={1}>
                  {seg.staffs.map((ss, sidx) => {
                    return (
                      <Stack key={sidx} direction="row" spacing={1} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 140, flex: 1 }}>
                          <InputLabel>スタッフ</InputLabel>
                          <Select
                            label="スタッフ"
                            value={ss.staff_id}
                            onChange={(e) => {
                              const updated = [...seg.staffs];
                              updated[sidx] = { ...updated[sidx], staff_id: e.target.value };
                              updateSegment(idx, { staffs: updated });
                            }}
                          >
                            {allStaffs.map(s => (
                              <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <FormControl size="small" sx={{ minWidth: 120, flex: 1 }}>
                          <InputLabel>役割</InputLabel>
                          <Select
                            label="役割"
                            value={ss.staff_role_id}
                            onChange={(e) => {
                              const updated = [...seg.staffs];
                              updated[sidx] = { ...updated[sidx], staff_role_id: e.target.value };
                              updateSegment(idx, { staffs: updated });
                            }}
                          >
                            <MenuItem value=""><em>未設定</em></MenuItem>
                            {staffRoles.map(r => (
                              <MenuItem key={r.id} value={r.id}>
                                {r.name}{r.is_unpaid && <Chip size="small" label="無給" color="warning" variant="outlined" sx={{ ml: 0.5, height: 16, fontSize: '0.65rem' }} />}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <IconButton
                          size="small"
                          onClick={() => {
                            const updated = seg.staffs.filter((_, i) => i !== sidx);
                            updateSegment(idx, { staffs: updated });
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    );
                  })}
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      const updated = [...seg.staffs, { staff_id: '', staff_role_id: '' }];
                      updateSegment(idx, { staffs: updated });
                    }}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    スタッフを追加
                  </Button>
                </Stack>
              </Box>
            </Stack>
          </Box>
        ))}

        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={addSegment}
          sx={{ alignSelf: 'flex-start' }}
        >
          区間を追加
        </Button>
      </Stack>

      {dirty && (
        <Box mt={2}>
          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中...' : '区間を保存'}
          </Button>
        </Box>
      )}
    </Box>
  );
}
