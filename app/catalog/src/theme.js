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
          borderRadius: 4,
          padding: '6px 16px',
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
          },
        },
        containedPrimary: {
          backgroundColor: '#000035',
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#1e293b',
          },
        },
        outlinedPrimary: {
          borderColor: '#e2e8f0',
          color: '#45464d',
          backgroundColor: '#ffffff',
          '&:hover': {
            borderColor: '#76777d',
            backgroundColor: '#f2f4f6',
          },
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
  },
});

export default theme;

