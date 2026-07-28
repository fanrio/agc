import React, { useRef, useState, useEffect } from 'react';
import { Box, Chip, Menu, MenuItem, Typography } from '@mui/material';

export default function TemplateNameEditor({ value = '', onChange, availableFields = [] }) {
  const [segments, setSegments] = useState([]);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(null);
  const [caretPos, setCaretPos] = useState(0);
  const inputRefs = useRef([]);

  // Parse string value (e.g. "ROLE_{CostCenter}_CUSTOM") to segments
  useEffect(() => {
    if (!value) {
      setSegments([{ type: 'text', value: '' }]);
      return;
    }
    const regex = /(\{[a-zA-Z0-9_]+\})/g;
    const parts = value.split(regex);
    const parsed = parts.map(part => {
      if (part.startsWith('{') && part.endsWith('}')) {
        return { type: 'chip', value: part.slice(1, -1) };
      }
      return { type: 'text', value: part };
    });

    // Ensure we alternate text and chip segments correctly (with text input always at start/end and between chips)
    const normalized = [];
    for (let i = 0; i < parsed.length; i++) {
      const curr = parsed[i];
      if (curr.type === 'chip') {
        if (normalized.length === 0 || normalized[normalized.length - 1].type === 'chip') {
          normalized.push({ type: 'text', value: '' });
        }
        normalized.push(curr);
      } else {
        normalized.push(curr);
      }
    }
    if (normalized.length === 0 || normalized[normalized.length - 1].type === 'chip') {
      normalized.push({ type: 'text', value: '' });
    }
    setSegments(normalized);
  }, [value]);

  const serialize = (segs) => {
    return segs.map(s => s.type === 'chip' ? `{${s.value}}` : s.value).join('');
  };

  const handleTextChange = (index, newVal) => {
    const next = [...segments];
    next[index].value = newVal;
    setSegments(next);
    onChange(serialize(next));
  };

  const handleKeyDown = (e, index) => {
    const input = e.target;
    const cursor = input.selectionStart;

    // CTRL + Space -> Open popup menu
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      setActiveSegmentIndex(index);
      setCaretPos(cursor);
      setMenuAnchor(input);
      return;
    }

    // Backspace at cursor position 0 -> delete preceding chip if it exists
    if (e.key === 'Backspace' && cursor === 0 && index > 0) {
      const prevChipIndex = index - 1;
      if (segments[prevChipIndex].type === 'chip') {
        e.preventDefault();
        const next = [...segments];
        next.splice(prevChipIndex, 1); // remove chip

        // Now merge the text segments before and after the deleted chip
        const textBeforeIdx = prevChipIndex - 1;
        const textAfterIdx = prevChipIndex;
        const mergeVal = next[textBeforeIdx].value + next[textAfterIdx].value;
        const targetFocusIndex = textBeforeIdx;
        const targetCaret = next[textBeforeIdx].value.length;

        next[textBeforeIdx].value = mergeVal;
        next.splice(textAfterIdx, 1);

        setSegments(next);
        onChange(serialize(next));

        // Focus the merged input and set cursor position
        setTimeout(() => {
          const el = inputRefs.current[targetFocusIndex];
          if (el) {
            el.focus();
            el.setSelectionRange(targetCaret, targetCaret);
          }
        }, 0);
      }
    }
  };

  const handleSelectField = (fieldName) => {
    if (activeSegmentIndex === null) return;
    const textSegment = segments[activeSegmentIndex];
    const textVal = textSegment.value;
    const before = textVal.slice(0, caretPos);
    const after = textVal.slice(caretPos);

    const next = [...segments];
    // Split and insert
    next.splice(activeSegmentIndex, 1,
      { type: 'text', value: before },
      { type: 'chip', value: fieldName },
      { type: 'text', value: after }
    );

    setSegments(next);
    onChange(serialize(next));
    setMenuAnchor(null);

    // Focus the text segment right after the newly inserted chip
    const nextTextIndex = activeSegmentIndex + 2;
    setTimeout(() => {
      const el = inputRefs.current[nextTextIndex];
      if (el) {
        el.focus();
        el.setSelectionRange(0, 0);
      }
    }, 0);
  };

  const handleDeleteChip = (chipIdx) => {
    const next = [...segments];
    next.splice(chipIdx, 1);
    
    // Merge the text inputs on both sides of the deleted chip
    const textBeforeIdx = chipIdx - 1;
    const textAfterIdx = chipIdx;
    if (next[textBeforeIdx] && next[textAfterIdx]) {
      next[textBeforeIdx].value = next[textBeforeIdx].value + next[textAfterIdx].value;
      next.splice(textAfterIdx, 1);
    }

    setSegments(next);
    onChange(serialize(next));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 0.75,
        p: '6px 12px',
        bgcolor: '#ffffff',
        border: '1px solid #CBD5E1',
        borderRadius: '4px',
        minHeight: 38,
        transition: 'all 0.2s',
        '&:hover': {
          borderColor: '#76777d',
        },
        '&:focus-within': {
          borderColor: 'primary.main',
          boxShadow: '0 0 0 1px #000035',
          bgcolor: '#ffffff',
        }
      }}>
        {segments.map((seg, idx) => {
          if (seg.type === 'chip') {
            return (
              <Chip
                key={idx}
                label={seg.value}
                size="small"
                onDelete={() => handleDeleteChip(idx)}
                color="secondary"
                sx={{
                  height: 24,
                  fontSize: '11px',
                  fontWeight: 600,
                  bgcolor: 'rgba(147, 51, 234, 0.08)',
                  border: '1px solid rgba(147, 51, 234, 0.3)',
                  color: '#7e22ce',
                  '& .MuiChip-deleteIcon': {
                    color: '#7e22ce',
                    '&:hover': { color: 'error.main' }
                  }
                }}
              />
            );
          }
          return (
            <input
              key={idx}
              ref={el => inputRefs.current[idx] = el}
              type="text"
              value={seg.value}
              onChange={e => handleTextChange(idx, e.target.value)}
              onKeyDown={e => handleKeyDown(e, idx)}
              placeholder={segments.length === 1 && !seg.value ? "Type template (e.g. ROLE_)... Ctrl+Space for fields" : ""}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'inherit',
                fontFamily: 'inherit',
                fontSize: '13px',
                minWidth: segments.length === 1 && !seg.value ? '280px' : '4px',
                width: segments.length === 1 && !seg.value ? '100%' : `${Math.max(1, seg.value.length) * 8 + 4}px`,
                padding: '2px 0',
              }}
            />
          );
        })}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, ml: 0.5 }}>
        Tip: Press <Box component="span" sx={{ fontWeight: 600, color: 'primary.light' }}>Ctrl + Space</Box> inside the input to select a restriction field name.
      </Typography>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        autoFocus={false}
        disableAutoFocusItem
        PaperProps={{
          sx: {
            maxHeight: 200,
            width: '24ch',
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 16px -4px rgba(0,0,0,0.5)',
          }
        }}
      >
        {availableFields.length === 0 ? (
          <MenuItem disabled sx={{ fontSize: 13 }}>
            <em>No fields defined in domain</em>
          </MenuItem>
        ) : (
          availableFields.map(f => (
            <MenuItem key={f} onClick={() => handleSelectField(f)} sx={{ fontSize: 13, py: 0.75 }}>
              {f}
            </MenuItem>
          ))
        )}
      </Menu>
    </Box>
  );
}
