import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#000035', // Deep Navy
      light: '#3a485c',
      dark: '#0b1220',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#515f74', // Slate
      light: '#75859d',
      dark: '#38485d',
      contrastText: '#ffffff',
    },
    background: {
      default: '#f7f9fb', // Tonal floor
      paper: '#ffffff',   // Cards & Dialogs surface
    },
    text: {
      primary: '#191c1e',
      secondary: '#45464d',
    },
    error: {
      main: '#ba1a1a',
      light: '#ffdad6',
      dark: '#93000a',
      contrastText: '#ffffff',
    },
    success: {
      main: '#10b981',
      light: '#d1fae5',
      dark: '#047857',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#d97706',
      light: '#fef3c7',
      dark: '#b45309',
      contrastText: '#ffffff',
    },
    info: {
      main: '#2563eb',
      light: '#dbeafe',
      dark: '#1d4ed8',
      contrastText: '#ffffff',
    },
    divider: '#e2e8f0', // outline-variant / Slate-200 border
  },
  typography: {
    fontFamily: 'inherit',
    h5: {
      fontFamily: 'inherit',
      fontWeight: 700,
      fontSize: '1.5rem',
      letterSpacing: '-0.01em',
    },
    h6: {
      fontFamily: 'inherit',
      fontWeight: 600,
      fontSize: '1.125rem',
    },
    subtitle1: {
      fontFamily: 'inherit',
      fontWeight: 600,
      fontSize: '1rem',
    },
    body1: {
      fontFamily: 'inherit',
      fontSize: '0.875rem', // 14px body-md
      lineHeight: 1.43,
    },
    body2: {
      fontFamily: 'inherit',
      fontSize: '0.8125rem', // 13px body-sm
      lineHeight: 1.38,
    },
    button: {
      fontFamily: 'inherit',
      fontWeight: 700,
      textTransform: 'none',
    },
  },
  shape: {
    borderRadius: 4, // Soft 0.25rem DEFAULT radius
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0', // outline-variant border
          borderRadius: 8, // rounded-lg
          boxShadow: 'none', // Flat Level 1 Surface
          backgroundImage: 'none',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            borderColor: '#000035', // border-primary
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 700,
          borderRadius: 6,
          padding: '6px 16px',
          boxShadow: 'none',
          transition: 'all 0.15s ease-in-out',
          '&:hover': {
            boxShadow: 'none',
          },
          '&:focus-visible': {
            outline: '2px solid #000035',
            outlineOffset: '2px',
          },
        },
        sizeSmall: {
          padding: '4px 12px',
          fontSize: '0.8125rem',
        },
        containedPrimary: {
          backgroundColor: '#000035',
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#1e293b',
          },
        },
        containedError: {
          backgroundColor: '#ba1a1a',
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#93000a',
          },
        },
        outlined: {
          borderColor: '#cbd5e1',
          color: '#45464d',
          backgroundColor: '#ffffff',
          '&:hover': {
            borderColor: '#000035',
            color: '#000035',
            backgroundColor: '#f2f4f6',
          },
        },
        outlinedPrimary: {
          borderColor: '#cbd5e1',
          color: '#000035',
          backgroundColor: '#ffffff',
          '&:hover': {
            borderColor: '#000035',
            backgroundColor: '#f2f4f6',
          },
        },
        outlinedError: {
          borderColor: '#ba1a1a',
          color: '#ba1a1a',
          backgroundColor: '#ffffff',
          '&:hover': {
            borderColor: '#93000a',
            backgroundColor: '#ffdad6',
          },
        },
        text: {
          color: '#45464d',
          '&:hover': {
            color: '#000035',
            backgroundColor: '#f2f4f6',
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
          fontSize: '0.8125rem',
          alignItems: 'center',
        },
        standardError: {
          backgroundColor: '#ffdad6',
          color: '#93000a',
          border: '1px solid rgba(186, 26, 26, 0.25)',
          '& .MuiAlert-icon': { color: '#ba1a1a' },
        },
        standardSuccess: {
          backgroundColor: '#d1fae5',
          color: '#047857',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          '& .MuiAlert-icon': { color: '#047857' },
        },
        standardWarning: {
          backgroundColor: '#fef3c7',
          color: '#b45309',
          border: '1px solid rgba(217, 119, 6, 0.25)',
          '& .MuiAlert-icon': { color: '#d97706' },
        },
        standardInfo: {
          backgroundColor: '#dbeafe',
          color: '#1d4ed8',
          border: '1px solid rgba(37, 99, 235, 0.25)',
          '& .MuiAlert-icon': { color: '#2563eb' },
        },
        filledError: {
          backgroundColor: '#ba1a1a',
          color: '#ffffff',
          boxShadow: '0 8px 24px rgba(0, 0, 53, 0.16)',
        },
        filledSuccess: {
          backgroundColor: '#047857',
          color: '#ffffff',
          boxShadow: '0 8px 24px rgba(0, 0, 53, 0.16)',
        },
        filledWarning: {
          backgroundColor: '#b45309',
          color: '#ffffff',
          boxShadow: '0 8px 24px rgba(0, 0, 53, 0.16)',
        },
        filledInfo: {
          backgroundColor: '#000035',
          color: '#ffffff',
          boxShadow: '0 8px 24px rgba(0, 0, 53, 0.16)',
        },
      },
    },
    MuiSnackbar: {
      defaultProps: {
        anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
        autoHideDuration: 4500,
      },
    },
    MuiChip: {
      defaultProps: {
        size: 'small',
      },
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 600,
          letterSpacing: '0.01em',
          transition: 'all 0.15s ease-in-out',
        },
        sizeSmall: {
          height: 22,
          fontSize: '0.72rem',
          '& .MuiChip-label': {
            paddingLeft: 8,
            paddingRight: 8,
          },
          '& .MuiChip-icon': {
            marginLeft: 6,
            marginRight: -2,
            fontSize: 13,
          },
          '& .MuiChip-deleteIcon': {
            marginRight: 4,
            fontSize: 14,
          },
        },
        sizeMedium: {
          height: 26,
          fontSize: '0.78rem',
        },
        colorDefault: {
          backgroundColor: '#f2f4f6',
          color: '#45464d',
          border: '1px solid #cbd5e1',
          '& .MuiChip-icon': { color: '#515f74' },
        },
        colorPrimary: {
          backgroundColor: 'rgba(0, 0, 53, 0.07)',
          color: '#000035',
          border: '1px solid rgba(0, 0, 53, 0.22)',
          '& .MuiChip-icon': { color: '#000035' },
          '& .MuiChip-deleteIcon': {
            color: 'rgba(0, 0, 53, 0.6)',
            '&:hover': { color: '#000035' },
          },
        },
        colorSecondary: {
          backgroundColor: 'rgba(81, 95, 116, 0.10)',
          color: '#38485d',
          border: '1px solid rgba(81, 95, 116, 0.25)',
          '& .MuiChip-icon': { color: '#38485d' },
          '& .MuiChip-deleteIcon': {
            color: 'rgba(56, 72, 93, 0.6)',
            '&:hover': { color: '#38485d' },
          },
        },
        colorSuccess: {
          backgroundColor: '#d1fae5',
          color: '#047857',
          border: '1px solid rgba(4, 120, 87, 0.28)',
          '& .MuiChip-icon': { color: '#047857' },
        },
        colorError: {
          backgroundColor: '#ffdad6',
          color: '#93000a',
          border: '1px solid rgba(186, 26, 26, 0.28)',
          '& .MuiChip-icon': { color: '#93000a' },
        },
        colorWarning: {
          backgroundColor: '#fef3c7',
          color: '#b45309',
          border: '1px solid rgba(180, 83, 9, 0.28)',
          '& .MuiChip-icon': { color: '#b45309' },
        },
        colorInfo: {
          backgroundColor: '#dbeafe',
          color: '#1d4ed8',
          border: '1px solid rgba(29, 78, 216, 0.28)',
          '& .MuiChip-icon': { color: '#1d4ed8' },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: '#ffffff',
            borderRadius: 4,
            '& fieldset': {
              borderColor: '#CBD5E1',
            },
            '&:hover fieldset': {
              borderColor: '#76777d',
            },
            '&.Mui-focused fieldset': {
              borderColor: '#000035',
              borderWidth: 2,
            },
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: {
          backgroundColor: '#ffffff',
          borderRadius: 4,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#CBD5E1',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#76777d',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#000035',
            borderWidth: 2,
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          boxShadow: '0px 20px 25px -5px rgba(0,0,0,0.1)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: '#e2e8f0',
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          transition: 'all 0.15s ease-in-out',
          '&:focus-visible': {
            outline: '2px solid #000035',
            outlineOffset: '2px',
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#000035',
          fontSize: '0.75rem',
          fontWeight: 600,
          borderRadius: 4,
          padding: '4px 8px',
        },
        arrow: {
          color: '#000035',
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          '--accent-primary': '#000035',
          '--color-primary': '#000035',
          '--color-secondary': '#515f74',
        },
        '*': {
          boxSizing: 'border-box',
          margin: 0,
          padding: 0,
        },
        'html, body, #root': {
          height: '100%',
          backgroundColor: '#f7f9fb',
          color: '#191c1e',
          fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          fontSize: '15px',
          lineHeight: 1.6,
          WebkitFontSmoothing: 'antialiased',
        },
        '::-webkit-scrollbar': {
          width: '6px',
          height: '6px',
        },
        '::-webkit-scrollbar-track': {
          background: '#f7f9fb',
        },
        '::-webkit-scrollbar-thumb': {
          background: '#cbd5e1',
          borderRadius: '3px',
        },
        '::-webkit-scrollbar-thumb:hover': {
          background: '#94a3b8',
        },
        '@keyframes fadeIn': {
          from: { opacity: 0, transform: 'translateY(4px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        '@keyframes pulse': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.4 },
        },
      },
    },
  },
});

export default theme;
