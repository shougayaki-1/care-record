'use client';

import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from '@mui/material';

type Props = {
    openCloseDialog: boolean;
    setOpenCloseDialog: (val: boolean) => void;
    openApproveDialog: boolean;
    setOpenApproveDialog: (val: boolean) => void;
    openSubmitDialog: boolean;
    setOpenSubmitDialog: (val: boolean) => void;
    openRemandDialog: boolean;
    setOpenRemandDialog: (val: boolean) => void;
    handleDialogDiscard: () => void;
    handleDialogSaveDraft: () => Promise<void>;
    executeApprove: () => Promise<void>;
    executeRemand: () => Promise<void>;
    executeSubmit: () => Promise<void>;
};

export function RecordActions({
    openCloseDialog, setOpenCloseDialog,
    openApproveDialog, setOpenApproveDialog,
    openSubmitDialog, setOpenSubmitDialog,
    openRemandDialog, setOpenRemandDialog,
    handleDialogDiscard, handleDialogSaveDraft,
    executeApprove, executeRemand, executeSubmit
}: Props) {
    return (
        <>
            <Dialog open={openCloseDialog} onClose={() => setOpenCloseDialog(false)}>
                <DialogTitle>保存されていない変更があります</DialogTitle>
                <DialogContent><DialogContentText>入力内容が保存されていません。<br/>下書きとして保存しますか？</DialogContentText></DialogContent>
                <DialogActions><Button onClick={handleDialogDiscard} color="error">破棄して移動</Button><Button onClick={handleDialogSaveDraft} variant="contained" autoFocus>下書き保存</Button></DialogActions>
            </Dialog>
            <Dialog open={openApproveDialog} onClose={() => setOpenApproveDialog(false)}>
                <DialogTitle>承認の確認</DialogTitle>
                <DialogContent><DialogContentText>この記録を承認しますか？</DialogContentText></DialogContent>
                <DialogActions><Button onClick={() => setOpenApproveDialog(false)}>キャンセル</Button><Button onClick={executeApprove} variant="contained" color="success" autoFocus>承認する</Button></DialogActions>
            </Dialog>
            <Dialog open={openRemandDialog} onClose={() => setOpenRemandDialog(false)}>
                <DialogTitle>承認取消の確認</DialogTitle>
                <DialogContent><DialogContentText>承認を取り消し、差し戻しますか？</DialogContentText></DialogContent>
                <DialogActions><Button onClick={() => setOpenRemandDialog(false)}>キャンセル</Button><Button onClick={executeRemand} variant="contained" color="warning" autoFocus>差し戻す</Button></DialogActions>
            </Dialog>
            <Dialog open={openSubmitDialog} onClose={() => setOpenSubmitDialog(false)}>
                <DialogTitle>送信の確認</DialogTitle>
                <DialogContent><DialogContentText>記録を送信しますか？</DialogContentText></DialogContent>
                <DialogActions><Button onClick={() => setOpenSubmitDialog(false)}>キャンセル</Button><Button onClick={executeSubmit} variant="contained" color="primary" autoFocus>送信する</Button></DialogActions>
            </Dialog>
        </>
    );
}