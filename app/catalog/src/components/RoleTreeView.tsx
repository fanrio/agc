import { useMemo } from 'react';
import { Box, Typography, Card } from '@mui/material';
import RoleCard from './RoleCard';

export default function RoleTreeView({
  roles,
  allRoles = [],
  orgNodes = [],
  onDeriveRole,
  onEditRole,
  onRefresh,
  onError,
  onSuccess,
  permissions
}: any) {
  const { rootRoles, roleById, childrenByParentId } = useMemo(() => {
    const rMap = new Map<string, any>();
    const cMap = new Map<string, any[]>();
    const visibleIds = new Set<string>();

    for (let i = 0; i < roles.length; i++) {
      visibleIds.add(roles[i].ID);
    }

    for (let i = 0; i < allRoles.length; i++) {
      const r = allRoles[i];
      if (!r?.ID) continue;
      rMap.set(r.ID, r);
      if (Array.isArray(r.parentRoles)) {
        for (let j = 0; j < r.parentRoles.length; j++) {
          const pr = r.parentRoles[j];
          const pid = pr?.parent_ID || pr?.parent?.ID;
          if (pid) {
            const list = cMap.get(pid);
            if (list) list.push(r);
            else cMap.set(pid, [r]);
          }
        }
      }
    }

    const roots = roles.filter((r: any) => {
      if (!r.parentRoles || r.parentRoles.length === 0) return true;
      return !r.parentRoles.some((pr: any) => {
        const parentId = pr.parent_ID || pr.parent?.ID;
        return parentId && visibleIds.has(parentId);
      });
    });

    return { rootRoles: roots, roleById: rMap, childrenByParentId: cMap };
  }, [roles, allRoles]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rootRoles.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No root roles found matching the current filters.
          </Typography>
        </Card>
      ) : (
        rootRoles.map((root: any) => (
          <RoleCard
            key={root.ID}
            role={root}
            allRoles={allRoles}
            roleById={roleById}
            childrenByParentId={childrenByParentId}
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
