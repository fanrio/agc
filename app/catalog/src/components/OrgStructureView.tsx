import HierarchicalManager from './HierarchicalManager';
import * as api from '../api';
import { Globe, Building2, MapPin, Factory, Briefcase } from 'lucide-react';
import { usePermissions } from '../context/PermissionsContext';

const TYPE_ICONS = {
  Global:     Globe,
  Region:     Building2,
  Country:    MapPin,
  Plant:      Factory,
  Department: Briefcase,
};

export default function OrgStructureView({ onGenerateRole }) {
  const { permissions } = usePermissions();
  const canManage = permissions?.isSuperAdmin || permissions?.canManageOrgRoles;

  return (
    <HierarchicalManager
      title="Organizational Structure"
      subtitle="Maintain your business hierarchy — roles are generated from this structure"
      emptyTitle="No organizational nodes yet"
      emptySubtitle="Add a root node to get started (e.g. Global)."
      addNodePlaceholder="Node name (e.g. Asia Pacific)"
      
      // API Calls
      fetchNodesFlat={api.getAllOrgNodesFlat}
      createNode={api.createOrgNode}
      updateNode={api.updateOrgNode}
      deleteNode={api.deleteOrgNode}
      createAttribute={api.createOrgAttr}
      deleteAttribute={api.deleteOrgAttr}
      
      // Style
      typeIcons={TYPE_ICONS}
      defaultIcon={Building2}
      
      // Actions
      onGenerateNode={onGenerateRole}
      onGenerateAll={api.generateAllOrgRoles}
      generateAllText="Generate All Roles"
      
      canManage={canManage}
    />
  );
}
