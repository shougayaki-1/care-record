'use client';

import { Box, Tooltip, IconButton, Avatar, Divider } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useRouter } from 'next/navigation';
import { Workspace } from '@/context/WorkspaceContext';

const RAIL_WIDTH = 72;

type Props = {
  orgList: Workspace[];
  currentOrg: Workspace | null;
  switchOrg: (orgId: string) => void;
};

export const ServerRail = ({ orgList, currentOrg, switchOrg }: Props) => {
  const router = useRouter();

  return (
    <Box sx={{
      width: RAIL_WIDTH,
      bgcolor: '#E3E5E8',
      borderRight: 'none',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      py: 2,
      gap: 1.5,
      overflowY: 'auto',
      flexShrink: 0,
      '&::-webkit-scrollbar': { display: 'none' }
    }}>
      {orgList.map(org => {
        const isSelected = currentOrg?.id === org.id;
        return (
          <Tooltip key={org.id} title={org.name} placement="right">
            <IconButton
              onClick={() => switchOrg(org.id)}
              sx={{
                p: 0,
                border: isSelected ? `2px solid #2255CC` : '2px solid transparent',
                borderRadius: '50%',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: isSelected ? '#2255CC' : 'rgba(0,0,0,0.1)'
                }
              }}
            >
              <Avatar
                sx={{
                  bgcolor: isSelected ? '#2255CC' : '#F2F3F5',
                  color: isSelected ? '#fff' : '#555',
                  width: 48, height: 48,
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  boxShadow: isSelected ? 2 : 0,
                  transition: 'all 0.2s',
                  '&:hover': { bgcolor: isSelected ? '#2255CC' : '#fff' }
                }}
              >
                {org.name.slice(0, 1)}
              </Avatar>
            </IconButton>
          </Tooltip>
        );
      })}

      <Divider flexItem sx={{ mx: 2, borderColor: 'rgba(0,0,0,0.06)' }} />

      <Tooltip title="事業所を追加 / 参加" placement="right">
        <IconButton
          sx={{
            width: 48, height: 48,
            bgcolor: '#F2F3F5', color: '#23A559',
            transition: 'all 0.2s',
            '&:hover': { bgcolor: '#23A559', color: '#fff' }
          }}
          onClick={() => router.push('/setup')}
        >
          <AddIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
};