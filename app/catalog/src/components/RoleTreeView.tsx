import { Box, Typography, Card } from '@mui/material';
import RoleCard from './RoleCard';

export default function RoleTreeView({
  roles,
  allRoles,
  orgNodes,
  onDeriveRole,
  onEditRole,
  onRefresh,
  onError,
  onSuccess,
  permissions
}) {
  const rootRoles = roles.filter(r => {
    if (!r.parentRoles || r.parentRoles.length === 0) return true;
    return !r.parentRoles.some(pr => {
      const parentId = pr.parent_ID || pr.parent?.ID;
      return roles.some(vr => vr.ID === parentId);
    });
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rootRoles.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No root roles found matching the current filters.
          </Typography>
        </Card>
      ) : (
        rootRoles.map(root => (
          <RoleCard
            key={root.ID}
            role={root}
            allRoles={allRoles}
            orgNodes={orgNodes}
            depth={0}
            onDerive={onDeriveRole}
            onEdit={onEditRole}
            onRefresh={onRefresh}
            onError={onError}
            onSuccess={onSuccess}
            isCompact={false}
            permissions={permissions}
          />
        ))
      )}
    </Box>
  );
}
