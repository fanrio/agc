import HierarchicalManager from './HierarchicalManager';
import * as api from '../api';
import { Network, Server, Cpu, Database, Blocks } from 'lucide-react';
import { usePermissions } from '../context/PermissionsContext';

export default function StreamsView() {
  const { permissions } = usePermissions();
  const canManage = permissions?.isSuperAdmin || permissions?.canManageSettings;

  return (
    <HierarchicalManager
      title="Streams"
      subtitle="Maintain your stream hierarchy — defining domains, modules, and streams"
      emptyTitle="No streams yet"
      emptySubtitle="Add a root node to get started (e.g. Global)."
      addNodePlaceholder="Name (max 10)"
      
      // API Calls
      fetchNodesFlat={api.getStreamsFlat}
      createNode={api.createStreamNode}
      updateNode={api.updateStreamNode}
      deleteNode={api.deleteStreamNode}
      createAttribute={api.createStreamAttr}
      deleteAttribute={api.deleteStreamAttr}
      
      // Style
      defaultIcon={Blocks}
      
      // Configuration
      showTypeSelector={false}
      showDescriptionField={true}
      maxNameLength={10}
      
      canManage={canManage}
    />
  );
}
