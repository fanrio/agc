import { useState, useEffect, useRef } from 'react';
import { 
  FlexBox, 
  Card, 
  CardHeader, 
  Title, 
  Label, 
  Button, 
  Input, 
  Select, 
  Option, 
  MultiComboBox, 
  MultiComboBoxItem, 
  Tag, 
  Icon, 
  Toast 
} from '@ui5/webcomponents-react';
import "@ui5/webcomponents-icons/dist/locked.js";
import "@ui5/webcomponents-icons/dist/unlocked.js";
import "@ui5/webcomponents-icons/dist/decline.js";
import "@ui5/webcomponents-icons/dist/add.js";
import "@ui5/webcomponents-icons/dist/filter.js";
import * as api from '../api';

// Helper to structure flat list into hierarchical select options with indentation
function getHierarchyOptions(flatNodes) {
  const map = {};
  flatNodes.forEach(node => {
    map[node.ID] = { ...node, children: [] };
  });

  const roots = [];
  flatNodes.forEach(node => {
    const mappedNode = map[node.ID];
    if (node.parent_ID && map[node.parent_ID]) {
      map[node.parent_ID].children.push(mappedNode);
    } else {
      roots.push(mappedNode);
    }
  });

  const result = [];
  function traverse(node, depth = 0) {
    result.push({ ...node, depth });
    if (node.children) {
      node.children.forEach(c => traverse(c, depth + 1));
    }
  }
  roots.forEach(r => traverse(r, 0));
  return result;
}

const FILTER_TYPES = ['SINGLE_VALUE', 'MULTI_VALUE', 'RANGE', 'HIERARCHY', 'PATTERN'];

const TYPE_COLOR_SCHEME = {
  SINGLE_VALUE: 1,
  MULTI_VALUE:  2,
  RANGE:        3,
  HIERARCHY:    5,
  PATTERN:      8,
};
const TYPE_LABEL = {
  SINGLE_VALUE: 'Equals',
  MULTI_VALUE:  'In List',
  RANGE:        'Range',
  HIERARCHY:    'Hierarchy',
  PATTERN:      'Pattern',
};

function TagInput({ values, onChange }) {
  const [input, setInput] = useState('');
  function addTag() {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput('');
  }
  return (
    <FlexBox direction="Column" style={{ gap: '0.5rem', width: '100%' }}>
      <FlexBox style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
        {values.map(v => (
          <Tag
            key={v}
            style={{ cursor: 'pointer' }}
            interactive
            onClick={() => onChange(values.filter(x => x !== v))}
          >
            {v} ✕
          </Tag>
        ))}
      </FlexBox>
      <Input
        placeholder="Type and press Enter…"
        value={input}
        onInput={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && addTag()}
        style={{ width: '100%' }}
      />
    </FlexBox>
  );
}

function RestrictionInput({ field, filterType, value, onChange, orgNodes = [], restrictionFields = [] }) {
  const matchingNodes = orgNodes.filter(n => (n.type?.name || '').toUpperCase() === (field || '').toUpperCase());
  const hasOrgOptions = matchingNodes.length > 0;

  // BDC Options Loader
  const fieldConfig = restrictionFields.find(f => f.name === field);
  const [bdcValues, setBdcValues] = useState([]);
  const [loadingBdc, setLoadingBdc] = useState(false);

  useEffect(() => {
    if (!fieldConfig || !fieldConfig.bdcConnection || !fieldConfig.asset) {
      setBdcValues([]);
      return;
    }
    setLoadingBdc(true);
    const conn = fieldConfig.bdcConnection;
    api.fetchBdcRelationalValues(
      conn.url, 
      conn.tokenUrl, 
      conn.clientId, 
      conn.clientSecret, 
      conn.space, 
      fieldConfig.asset, 
      fieldConfig.idColumns || '["id"]', 
      fieldConfig.textColumn || 'id'
    )
      .then(values => {
        setBdcValues(values || []);
      })
      .catch(e => {
        console.error('Failed to fetch BDC relational values:', e);
        setBdcValues([]);
      })
      .finally(() => {
        setLoadingBdc(false);
      });
  }, [fieldConfig, field]);

  const hasBdcOptions = bdcValues.length > 0;

  if (filterType === 'SINGLE_VALUE' || filterType === 'PATTERN') {
    if (loadingBdc) {
      return <Input disabled value="Loading values from Datasphere..." style={{ width: '100%' }} />;
    }
    if (hasBdcOptions) {
      return (
        <Select
          onChange={e => onChange(e.detail.selectedOption.value)}
          style={{ width: '100%' }}
        >
          <Option value="">None</Option>
          {bdcValues.map(v => (
            <Option key={v.id} value={v.id} selected={v.id === value}>{v.text}</Option>
          ))}
        </Select>
      );
    }
    if (hasOrgOptions) {
      return (
        <Select
          onChange={e => onChange(e.detail.selectedOption.value)}
          style={{ width: '100%' }}
        >
          <Option value="">None</Option>
          {matchingNodes.map(n => (
            <Option key={n.ID} value={n.name} selected={n.name === value}>{n.name}</Option>
          ))}
        </Select>
      );
    }
    return (
      <Input
        placeholder={filterType === 'PATTERN' ? 'e.g. CC1% or DE_' : 'e.g. Germany'}
        value={value}
        onInput={e => onChange(e.target.value)}
        style={{ width: '100%' }}
      />
    );
  }
  
  if (filterType === 'MULTI_VALUE') {
    if (loadingBdc) {
      return <Input disabled value="Loading values from Datasphere..." style={{ width: '100%' }} />;
    }
    if (hasBdcOptions) {
      const selectedIds = value ? JSON.parse(value) : [];
      return (
        <MultiComboBox
          onSelectionChange={e => {
            const selectedKeys = e.detail.items.map(item => item.getAttribute('value') || item.text);
            onChange(JSON.stringify(selectedKeys));
          }}
          style={{ width: '100%' }}
        >
          {bdcValues.map(v => (
            <MultiComboBoxItem key={v.id} value={v.id} text={v.text} selected={selectedIds.includes(v.id)} />
          ))}
        </MultiComboBox>
      );
    }
    if (hasOrgOptions) {
      const selectedNames = value ? JSON.parse(value) : [];
      return (
        <MultiComboBox
          onSelectionChange={e => {
            const selectedKeys = e.detail.items.map(item => item.getAttribute('value') || item.text);
            onChange(JSON.stringify(selectedKeys));
          }}
          style={{ width: '100%' }}
        >
          {matchingNodes.map(n => (
            <MultiComboBoxItem key={n.ID} value={n.name} text={n.name} selected={selectedNames.includes(n.name)} />
          ))}
        </MultiComboBox>
      );
    }
    const tags = value ? JSON.parse(value) : [];
    return <TagInput values={tags} onChange={arr => onChange(JSON.stringify(arr))} />;
  }

  if (filterType === 'RANGE') {
    const range = value ? JSON.parse(value) : { from: '', to: '' };
    if (loadingBdc) {
      return <Input disabled value="Loading values from Datasphere..." style={{ width: '100%' }} />;
    }
    if (hasBdcOptions) {
      return (
        <FlexBox style={{ gap: '0.5rem', alignItems: 'center', width: '100%' }}>
          <Select
            onChange={e => onChange(JSON.stringify({ ...range, from: e.detail.selectedOption.value }))}
            style={{ flexGrow: 1 }}
          >
            <Option value="">None</Option>
            {bdcValues.map(v => (
              <Option key={v.id} value={v.id} selected={v.id === range.from}>{v.text}</Option>
            ))}
          </Select>
          <Label>-</Label>
          <Select
            onChange={e => onChange(JSON.stringify({ ...range, to: e.detail.selectedOption.value }))}
            style={{ flexGrow: 1 }}
          >
            <Option value="">None</Option>
            {bdcValues.map(v => (
              <Option key={v.id} value={v.id} selected={v.id === range.to}>{v.text}</Option>
            ))}
          </Select>
        </FlexBox>
      );
    }
    if (hasOrgOptions) {
      return (
        <FlexBox style={{ gap: '0.5rem', alignItems: 'center', width: '100%' }}>
          <Select
            onChange={e => onChange(JSON.stringify({ ...range, from: e.detail.selectedOption.value }))}
            style={{ flexGrow: 1 }}
          >
            <Option value="">None</Option>
            {matchingNodes.map(n => (
              <Option key={n.ID} value={n.name} selected={n.name === range.from}>{n.name}</Option>
            ))}
          </Select>
          <Label>-</Label>
          <Select
            onChange={e => onChange(JSON.stringify({ ...range, to: e.detail.selectedOption.value }))}
            style={{ flexGrow: 1 }}
          >
            <Option value="">None</Option>
            {matchingNodes.map(n => (
              <Option key={n.ID} value={n.name} selected={n.name === range.to}>{n.name}</Option>
            ))}
          </Select>
        </FlexBox>
      );
    }
    return (
      <FlexBox style={{ gap: '0.5rem', alignItems: 'center', width: '100%' }}>
        <Input
          type="Number"
          placeholder="From"
          value={range.from}
          onInput={e => onChange(JSON.stringify({ ...range, from: e.target.value }))}
          style={{ flexGrow: 1 }}
        />
        <Label>-</Label>
        <Input
          type="Number"
          placeholder="To"
          value={range.to}
          onInput={e => onChange(JSON.stringify({ ...range, to: e.target.value }))}
          style={{ flexGrow: 1 }}
        />
      </FlexBox>
    );
  }

  if (filterType === 'HIERARCHY') {
    const sortedNodes = getHierarchyOptions(orgNodes);
    const selectedIds = value ? (value.startsWith('[') ? JSON.parse(value) : [value]) : [];

    const isAncestorSelected = (nodeId, currentSelection) => {
      let curr = orgNodes.find(x => x.ID === nodeId);
      while (curr && curr.parent_ID) {
        if (currentSelection.includes(curr.parent_ID)) {
          return true;
        }
        curr = orgNodes.find(x => x.ID === curr.parent_ID);
      }
      return false;
    };

    return (
      <MultiComboBox
        onSelectionChange={e => {
          const nextSelected = e.detail.items.map(item => item.getAttribute('value') || item.text);
          const filtered = nextSelected.filter(id => !isAncestorSelected(id, nextSelected));
          onChange(JSON.stringify(filtered));
        }}
        style={{ width: '100%' }}
      >
        {sortedNodes.map(n => {
          const isChecked = selectedIds.includes(n.ID);
          const isDisabled = isAncestorSelected(n.ID, selectedIds);
          
          return (
            <MultiComboBoxItem
              key={n.ID}
              value={n.ID}
              text={`${"  ".repeat(n.depth)}${n.name}`}
              additionalText={n.type?.name || ''}
              selected={isChecked}
              disabled={isDisabled}
            />
          );
        })}
      </MultiComboBox>
    );
  }
  return null;
}

const TYPE_DESIGN = {
  SINGLE_VALUE: "Set1",
  MULTI_VALUE:  "Set2",
  RANGE:        "Set3",
  HIERARCHY:    "Set5",
  PATTERN:      "Set8",
};

export function RestrictionDisplay({ restriction, isOwn = true }) {
  const design = TYPE_DESIGN[restriction.filterType] || "Set1";
  const label = TYPE_LABEL[restriction.filterType] || restriction.filterType;

  let display = restriction.value;
  if (restriction.filterType === 'MULTI_VALUE') {
    try { display = JSON.parse(restriction.value).join(', '); } catch {}
  } else if (restriction.filterType === 'RANGE') {
    try { const r = JSON.parse(restriction.value); display = `${r.from} – ${r.to}`; } catch {}
  } else if (restriction.filterType === 'HIERARCHY') {
    try {
      if (restriction.value.startsWith('[')) {
        display = JSON.parse(restriction.value).join(', ');
      }
    } catch {}
  }

  return (
    <FlexBox
      alignItems="Center"
      style={{
        flexWrap: 'wrap',
        gap: '0.75rem',
        padding: '0.5rem 1rem',
        backgroundColor: isOwn ? 'var(--sapList_SelectionBackgroundColor)' : 'var(--sapGroup_ContentBackground)',
        border: isOwn ? '1px solid var(--sapList_SelectionBorderColor)' : '1px solid var(--sapList_BorderColor)',
        borderRadius: '8px',
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      <Icon 
        name={isOwn ? "unlocked" : "locked"} 
        style={{ color: isOwn ? 'var(--sapContent_NonInteractiveIconColor)' : 'var(--sapContent_DisabledTextColor)' }} 
      />
      <span style={{ fontWeight: 'bold', minWidth: '90px', color: 'var(--sapContent_LabelColor)', fontFamily: 'var(--sapFontFamily)' }}>
        {restriction.field}
      </span>
      <Tag design={design}>{label}</Tag>
      <span style={{ fontFamily: 'var(--sapFontHeaderFamily)', color: 'var(--sapContent_TextColor)', flexGrow: 1 }}>
        {display}
      </span>
      {restriction.sourceRoleName && (
        <span style={{ fontStyle: 'italic', fontSize: '0.8rem', color: 'var(--sapContent_LabelColor)' }}>
          from: {restriction.sourceRoleName}
        </span>
      )}
    </FlexBox>
  );
}

export default function RestrictionBuilder({ restrictions, onChange, inheritedRestrictions = [], orgNodes = [], restrictionFields = [] }) {
  const [draft, setDraft] = useState({ field: '', filterType: 'SINGLE_VALUE', value: '' });
  const [toastMessage, setToastMessage] = useState('');
  const toastRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    toastRef.current?.show();
  };

  function addRestriction() {
    if (!draft.field.trim() || !draft.value) return;

    if (draft.filterType === 'RANGE') {
      try {
        const range = JSON.parse(draft.value);
        if (!range.from || !range.to) {
          showToast("Both 'From' and 'To' values must be specified.");
          return;
        }

        const fromNum = parseFloat(range.from);
        const toNum = parseFloat(range.to);

        if (!isNaN(fromNum) && !isNaN(toNum)) {
          if (fromNum >= toNum) {
            showToast("'From' value must be lower than 'To' value.");
            return;
          }
        } else {
          if (String(range.from).localeCompare(String(range.to)) >= 0) {
            showToast("'From' value must be lower than 'To' value.");
            return;
          }
        }
      } catch (e) {
        showToast("Invalid range values.");
        return;
      }
    }

    onChange([...restrictions, { ...draft, ID: `temp-${Date.now()}` }]);
    setDraft({ field: '', filterType: 'SINGLE_VALUE', value: '' });
  }

  function removeRestriction(id) {
    onChange(restrictions.filter(r => r.ID !== id));
  }

  return (
    <FlexBox direction="Column" style={{ width: '100%', gap: '1.5rem' }}>
      <Toast ref={toastRef}>{toastMessage}</Toast>

      {/* Inherited */}
      {inheritedRestrictions.length > 0 && (
        <FlexBox direction="Column" style={{ gap: '0.5rem', width: '100%' }}>
          <FlexBox alignItems="Center" style={{ gap: '0.4rem' }}>
            <Icon name="locked" style={{ fontSize: '0.9rem' }} />
            <Label style={{ fontWeight: 'bold' }}>Inherited from parent chain</Label>
          </FlexBox>
          <FlexBox direction="Column" style={{ gap: '0.5rem', width: '100%' }}>
            {inheritedRestrictions.map(r => (
              <RestrictionDisplay key={r.restrictionId || r.ID} restriction={{ ...r, field: r.field, filterType: r.filterType, value: r.value, sourceRoleName: r.sourceRoleName }} isOwn={false} />
            ))}
          </FlexBox>
        </FlexBox>
      )}

      {/* Own restrictions */}
      {restrictions.length > 0 && (
        <FlexBox direction="Column" style={{ gap: '0.5rem', width: '100%' }}>
          <FlexBox alignItems="Center" style={{ gap: '0.4rem' }}>
            <Icon name="unlocked" style={{ fontSize: '0.9rem' }} />
            <Label style={{ fontWeight: 'bold' }}>Own restrictions</Label>
          </FlexBox>
          <FlexBox direction="Column" style={{ gap: '0.5rem', width: '100%' }}>
            {restrictions.map(r => (
              <FlexBox key={r.ID} alignItems="Center" style={{ gap: '0.5rem', width: '100%' }}>
                <RestrictionDisplay restriction={r} isOwn={true} />
                <Button design="Transparent" icon="decline" onClick={() => removeRestriction(r.ID)} />
              </FlexBox>
            ))}
          </FlexBox>
        </FlexBox>
      )}

      {/* Add new restriction */}
      <Card style={{ padding: '1.5rem' }}>
        <FlexBox direction="Column" style={{ gap: '1rem', width: '100%' }}>
          <FlexBox alignItems="Center" style={{ gap: '0.4rem' }}>
            <Icon name="filter" />
            <Title level="H5">Add restriction</Title>
          </FlexBox>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'end', width: '100%' }}>
            <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
              <Label showColon>Field</Label>
              <Select
                onChange={e => setDraft(d => ({ ...d, field: e.detail.selectedOption.value }))}
                style={{ width: '100%' }}
              >
                <Option value="">Select Field</Option>
                {restrictionFields.map(f => (
                  <Option key={f.ID} value={f.name} selected={f.name === draft.field}>{f.name}</Option>
                ))}
              </Select>
            </FlexBox>

            <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
              <Label showColon>Type</Label>
              <Select
                onChange={e => setDraft(d => ({ ...d, filterType: e.detail.selectedOption.value, value: '' }))}
                style={{ width: '100%' }}
              >
                {FILTER_TYPES.map(t => (
                  <Option key={t} value={t} selected={t === draft.filterType}>{TYPE_LABEL[t]}</Option>
                ))}
              </Select>
            </FlexBox>

            <FlexBox direction="Column" style={{ gap: '0.4rem', flexGrow: 2 }}>
              <Label showColon>Value</Label>
              <RestrictionInput
                field={draft.field}
                filterType={draft.filterType}
                value={draft.value}
                onChange={v => setDraft(d => ({ ...d, value: v }))}
                orgNodes={orgNodes}
                restrictionFields={restrictionFields}
              />
            </FlexBox>

            <Button design="Emphasized" icon="add" onClick={addRestriction}>
              Add
            </Button>
          </div>
        </FlexBox>
      </Card>
    </FlexBox>
  );
}
