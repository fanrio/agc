import React from 'react';
import { Card, Typography } from '@mui/material';
import RestrictionBuilder from '../../RestrictionBuilder';

export default function StepRestrictions({
  restrictions, setRestrictions,
  inherited, orgNodes, selectableRestrictionFields
}) {
  return (
    <Card sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Data Access Restrictions</Typography>
      <RestrictionBuilder
        restrictions={restrictions}
        onChange={setRestrictions}
        inheritedRestrictions={inherited}
        orgNodes={orgNodes}
        restrictionFields={selectableRestrictionFields}
      />
    </Card>
  );
}
