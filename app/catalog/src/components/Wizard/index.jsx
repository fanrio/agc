import React from 'react';
import { Box, Stepper, Step, StepLabel, Button, Typography, Snackbar, Alert } from '@mui/material';
import { Check, ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { useWizardState } from './useWizardState';
import StepOrigin from './steps/StepOrigin';
import StepRestrictions from './steps/StepRestrictions';
import StepApprovers from './steps/StepApprovers';
import StepReview from './steps/StepReview';
import ImpactDialog from './ImpactDialog';

const STEPS = [
  { id: 'origin', label: 'Origin & Parent' },
  { id: 'restrictions', label: 'Restrictions' },
  { id: 'identity', label: 'Approvers' },
  { id: 'review', label: 'Review & Deploy' },
];

export default function Wizard({ context = {}, onDone, allowFreeNavigation = false }) {
  const { permissions } = usePermissions();
  const state = useWizardState({ context: { ...context, allowFreeNavigation }, permissions });

  console.log(context);
  if (state.done) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 8, animation: 'fadeIn 0.3s' }}>
        <Box sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: 'success.light', border: '2px solid', borderColor: 'success.main', display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 3 }}>
          <Check size={28} color="#1b5e20" />
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{state.isEditMode ? 'Role Updated' : 'Role Deployed'}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>The authorization role has been {state.isEditMode ? 'updated' : 'created'} successfully.</Typography>
        <Button variant="contained" onClick={onDone} startIcon={<Shield size={15} />}>View All Roles</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ animation: 'fadeIn 0.3s' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Authorization Wizard</Typography>
        <Typography variant="body2" color="text.secondary">Create a new Org-Based Role or Single Role step by step</Typography>
      </Box>

      <Snackbar
        open={state.snackbar.open}
        autoHideDuration={6000}
        onClose={state.handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={state.handleCloseSnackbar} severity={state.snackbar.severity} sx={{ width: '100%' }}>
          {state.snackbar.message}
        </Alert>
      </Snackbar>

      {/* Stepper */}
      <Box sx={{ mb: 4 }}>
        <Stepper activeStep={state.step} alternativeLabel>
          {STEPS.map((s, i) => (
            <Step key={s.id} onClick={() => { if (state.canNavigateTo(i)) state.setStep(i); }} sx={{ cursor: state.canNavigateTo(i) ? 'pointer' : 'default' }}>
              <StepLabel>{s.label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      {/* Step Content */}
      <Box sx={{ mb: 4 }}>
        {state.step === 0 && <StepOrigin {...state} permissions={permissions} context={context} />}
        {state.step === 1 && <StepRestrictions {...state} />}
        {state.step === 2 && <StepApprovers {...state} />}
        {state.step === 3 && <StepReview {...state} permissions={permissions} />}
      </Box>

      {/* Navigation Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
        <Button variant="outlined" color="error" onClick={onDone}>
          Cancel
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {state.step > 0 && (
            <Button variant="text" color="inherit" onClick={() => state.setStep(s => s - 1)} startIcon={<ChevronLeft size={15} />}>
              Back
            </Button>
          )}
          {state.step < 3 && (
            <Button
              variant="contained"
              onClick={() => state.setStep(s => s + 1)}
              disabled={state.step === 0 && state.roleType === 'ORG_BASED' && !state.selectedOrgNodeId}
              endIcon={<ChevronRight size={15} />}
            >
              Next
            </Button>
          )}
        </Box>
      </Box>

      {/* Impact Analysis Dialog */}
      <ImpactDialog
        open={state.showImpactDialog}
        roleName={state.roleName}
        impactData={state.impactData}
        onClose={() => state.setShowImpactDialog(false)}
        onConfirm={() => {
          state.setShowImpactDialog(false);
          state.handleDeploy();
        }}
      />
    </Box>
  );
}
