'use client';

import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, FormControl, IconButton, InputLabel, MenuItem,
  Select, Stack, Typography, Tooltip,
} from '@/components/ui/mui';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

import { getServiceTypes, type ServiceType } from '@/app/actions/serviceTypes';
import { getStaffRoles, type StaffRole } from '@/app/actions/staffRoles';
import { DateTimeField } from '@/components/ui';
import type { SegmentDraft } from '@/utils/shiftSegments';

type StaffData = { id: string; name: string };

type Props = {
  orgId: string;
  allStaffs: StaffData[];
  value: SegmentDraft[];
  onChange: (next: SegmentDraft[]) => void;
  defaultStart: string;
  defaultEnd: string;
  disabled?: boolean;
};

export default function ShiftSegmentEditor({
  orgId,
  allStaffs,
  value,
  onChange,
  defaultStart,
  defaultEnd,
  disabled = false,
}: Props) {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [staffRoles, setStaffRoles] = useState<StaffRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getServiceTypes(orgId), getStaffRoles(orgId)])
      .then(([types, roles]) => {
        if (!active) return;
        setServiceTypes(types.filter((type) => type.is_active));
        setStaffRoles(roles.filter((role) => role.is_active));
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'マスタの読み込みに失敗しました');
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  const updateSegment = (index: number, patch: Partial<SegmentDraft>) => {
    onChange(value.map((segment, current) => current === index ? { ...segment, ...patch } : segment));
  };

  const addSegment = () => {
    onChange([
      ...value,
      {
        service_type_id: '',
        start_at: value.length > 0 ? value[value.length - 1].end_at : defaultStart,
        end_at: defaultEnd,
        staffs: [],
      },
    ]);
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}
      {serviceTypes.length === 0 && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          サービス種別が未設定です。事業所設定から追加してください。
        </Alert>
      )}

      <Stack spacing={2}>
        {value.map((segment, index) => (
          <Box
            key={segment.id ?? index}
            sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              bgcolor: 'background.subtle',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
              <Typography variant="subtitle2" fontWeight="bold">区間 {index + 1}</Typography>
              <Tooltip title="この区間を削除">
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    disabled={disabled}
                    onClick={() => onChange(value.filter((_, current) => current !== index))}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>

            <Stack spacing={1.5}>
              <FormControl fullWidth size="small" disabled={disabled}>
                <InputLabel>サービス種別</InputLabel>
                <Select
                  label="サービス種別"
                  value={segment.service_type_id}
                  onChange={(event) => updateSegment(index, {
                    service_type_id: event.target.value,
                    service_type_name: serviceTypes.find((type) => type.id === event.target.value)?.name,
                  })}
                >
                  <MenuItem value=""><em>未設定</em></MenuItem>
                  {serviceTypes.map((type) => <MenuItem key={type.id} value={type.id}>{type.name}</MenuItem>)}
                </Select>
              </FormControl>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <DateTimeField
                  label="開始日時"
                  fullWidth
                  size="small"
                  disabled={disabled}
                  value={segment.start_at}
                  onChange={(event) => updateSegment(index, { start_at: event.target.value })}
                />
                <DateTimeField
                  label="終了日時"
                  fullWidth
                  size="small"
                  disabled={disabled}
                  value={segment.end_at}
                  onChange={(event) => updateSegment(index, { end_at: event.target.value })}
                />
              </Stack>

              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  スタッフと役割
                </Typography>
                <Stack spacing={1}>
                  {segment.staffs.map((staff, staffIndex) => (
                    <Stack key={staffIndex} direction="row" spacing={1} alignItems="center">
                      <FormControl size="small" sx={{ minWidth: 140, flex: 1 }} disabled={disabled}>
                        <InputLabel>スタッフ</InputLabel>
                        <Select
                          label="スタッフ"
                          value={staff.staff_id}
                          onChange={(event) => {
                            const nextStaffs = [...segment.staffs];
                            nextStaffs[staffIndex] = { ...staff, staff_id: event.target.value };
                            updateSegment(index, { staffs: nextStaffs });
                          }}
                        >
                          {allStaffs.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
                        </Select>
                      </FormControl>
                      <FormControl size="small" sx={{ minWidth: 120, flex: 1 }} disabled={disabled}>
                        <InputLabel>役割</InputLabel>
                        <Select
                          label="役割"
                          value={staff.staff_role_id}
                          onChange={(event) => {
                            const nextStaffs = [...segment.staffs];
                            nextStaffs[staffIndex] = { ...staff, staff_role_id: event.target.value };
                            updateSegment(index, { staffs: nextStaffs });
                          }}
                        >
                          <MenuItem value=""><em>未設定</em></MenuItem>
                          {staffRoles.map((role) => (
                            <MenuItem key={role.id} value={role.id}>
                              {role.name}
                              {role.is_unpaid && (
                                <Chip size="small" label="無給" color="warning" variant="outlined" sx={{ ml: 0.5, height: 16, fontSize: '0.65rem' }} />
                              )}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <IconButton
                        size="small"
                        disabled={disabled}
                        onClick={() => updateSegment(index, {
                          staffs: segment.staffs.filter((_, current) => current !== staffIndex),
                        })}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    disabled={disabled}
                    onClick={() => updateSegment(index, {
                      staffs: [...segment.staffs, { staff_id: '', staff_role_id: '' }],
                    })}
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
          disabled={disabled}
          onClick={addSegment}
          sx={{ alignSelf: 'flex-start' }}
        >
          区間を追加
        </Button>
      </Stack>
    </Box>
  );
}
