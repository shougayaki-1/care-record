import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Stack } from '@mui/material';
import { AppButton } from './AppButton';
import { EmptyState, PageBody, PageHeader, PageLayout, PageSection, PageToolbar, StatusChip } from './Layout';

const LayoutShowcase = () => (
  <PageLayout sx={{ height: 520, width: 720 }}>
    <PageBody>
      <PageHeader title="利用者管理" description="利用者情報を管理します" actions={<AppButton>新規登録</AppButton>} />
      <PageToolbar>
        <Stack direction="row" spacing={1}>
          <StatusChip label="有効" tone="success" />
          <StatusChip label="未承認" tone="warning" />
          <StatusChip label="エラー" tone="error" />
        </Stack>
      </PageToolbar>
      <PageSection>
        <EmptyState title="利用者が登録されていません" description="新規登録から利用者を追加してください" action={<AppButton variant="outlined">新規登録</AppButton>} />
      </PageSection>
    </PageBody>
  </PageLayout>
);

const meta = { title: 'UI/Layout and status', component: LayoutShowcase, tags: ['autodocs'], parameters: { layout: 'padded' } } satisfies Meta<typeof LayoutShowcase>;
export default meta;
export const Desktop: StoryObj<typeof meta> = {};
export const Mobile: StoryObj<typeof meta> = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
