import HierarchicalManager from './HierarchicalManager';
import * as api from '../api';
import { Network, Server, Cpu, Database, Blocks } from 'lucide-react';
import { usePermissions } from '../context/PermissionsContext';

export default function AccessDomainsView() {
  const { permissions } = usePermissions();
  const canManage = permissions?.isSuperAdmin || permissions?.canManageSettings;

  return (
    <HierarchicalManager
      title="Access Domains"
      subtitle="Maintain your access domain hierarchy — defining domains, modules, and sub-domains"
      emptyTitle="No access domains yet"
      emptySubtitle="Add a root node to get started (e.g. Global)."
      addNodePlaceholder="Name (max 10)"
      
      // API Calls
      fetchNodesFlat={api.getAccessDomainsFlat}
      createNode={api.createAccessDomainNode}
      updateNode={api.updateAccessDomainNode}
      deleteNode={api.deleteAccessDomainNode}
      createAttribute={api.createAccessDomainAttr}
      deleteAttribute={api.deleteAccessDomainAttr}
      
      // Style
      defaultIcon={Blocks}
      
      // Configuration
      showTypeSelector={false}
      showDescriptionField={true}
      maxNameLength={10}
      
      showRestrictionFields={true}
      createRestrictionField={api.createAccessDomainField}
      deleteRestrictionField={api.deleteAccessDomainField}
      
      showRoleTemplateName={true}
      
      canManage={canManage}
    />
  );
}
