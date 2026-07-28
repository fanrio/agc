import React from 'react';
import RoleAuditDetails from './RoleAuditDetails';
import RoleAssignmentAuditDetails from './RoleAssignmentAuditDetails';
import AppAuthorizationAuditDetails from './AppAuthorizationAuditDetails';
import DefaultAuditDetails from './DefaultAuditDetails';

export default function AuditDetailsDispatcher({ log, roles = [] }) {
  if (!log) return null;

  switch (log.entityName) {
    case 'Roles':
      return <RoleAuditDetails log={log} roles={roles} />;
    case 'RoleAssignments':
      return <RoleAssignmentAuditDetails log={log} roles={roles} />;
    case 'AppAuthorizations':
      return <AppAuthorizationAuditDetails log={log} roles={roles} />;
    default:
      return <DefaultAuditDetails log={log} roles={roles} />;
  }
}

export {
  RoleAuditDetails,
  RoleAssignmentAuditDetails,
  AppAuthorizationAuditDetails,
  DefaultAuditDetails
};
