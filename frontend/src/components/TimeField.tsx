import { createTheme, ThemeProvider } from "@mui/material/styles";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import "@mui/x-date-pickers/themeAugmentation";
import dayjs from "dayjs";
import { useId, useState } from "react";

type TimeFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  trailing?: React.ReactNode;
};

const coordinatorFont = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif";

/** Keeps MUI X's picker interaction while applying the coordinator tools design system. */
const coordinatorTimePickerTheme = createTheme({
  palette: {
    primary: {
      main: "#1f4e79",
      dark: "#183f63",
      light: "#dceaf6",
      contrastText: "#ffffff",
    },
    background: {
      default: "#f7f8fa",
      paper: "#ffffff",
    },
    text: {
      primary: "#171717",
      secondary: "#667085",
    },
  },
  shape: { borderRadius: 6 },
  typography: { fontFamily: coordinatorFont },
  components: {
    MuiPickersOutlinedInput: {
      styleOverrides: {
        root: {
          minHeight: 40,
          padding: "0 12px",
          borderRadius: 6,
          backgroundColor: "#ffffff",
          fontSize: "0.875rem",
          "& .MuiPickersOutlinedInput-notchedOutline": { borderColor: "#b7bec8" },
          "&:hover .MuiPickersOutlinedInput-notchedOutline": { borderColor: "#98a2b3" },
          "&.Mui-focused .MuiPickersOutlinedInput-notchedOutline": {
            borderColor: "#1f4e79",
            borderWidth: 1,
          },
          "& .MuiPickersSectionList-root": { padding: 0 },
          "& .MuiPickersSectionList-section": { color: "#344054" },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: { color: "#344054", fontSize: "0.875rem", fontWeight: 500 },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: "#1f4e79",
          borderRadius: 6,
          "&:hover": { backgroundColor: "#f2f7fb" },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          border: "1px solid #d9dee7",
          borderRadius: 8,
          boxShadow: "0 12px 28px rgba(31, 78, 121, 0.14)",
        },
      },
    },
    MuiMultiSectionDigitalClock: {
      styleOverrides: {
        root: {
          borderBottom: "none",
          minWidth: 184,
          padding: 4,
        },
      },
    },
    MuiMultiSectionDigitalClockSection: {
      styleOverrides: {
        root: {
          maxHeight: 264,
          width: 88,
          padding: 4,
          "&:not(:first-of-type)": { borderLeft: "1px solid #e5e7eb" },
        },
        item: {
          width: "100%",
          minHeight: 36,
          margin: "2px 0",
          borderRadius: 6,
          color: "#344054",
          fontSize: "0.875rem",
          fontWeight: 500,
          "&:hover": { backgroundColor: "#f2f7fb" },
          "&.Mui-selected": {
            backgroundColor: "#1f4e79",
            color: "#ffffff",
            "&:hover, &:focus-visible": { backgroundColor: "#183f63" },
          },
        },
      },
    },
    MuiClock: {
      styleOverrides: {
        clock: { backgroundColor: "#e8edf3" },
      },
    },
    MuiClockNumber: {
      styleOverrides: {
        root: { color: "#344054", fontSize: "0.875rem", fontWeight: 500 },
      },
    },
    MuiPickersLayout: {
      styleOverrides: {
        root: { padding: 4 },
      },
    },
  },
});

export function TimeField({ label, value, onChange, trailing }: TimeFieldProps) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="relative grid gap-1">
      <label id={labelId} htmlFor={fieldId} className="text-sm font-medium text-[#344054]">{label}</label>
      <div className="relative">
        <ThemeProvider theme={coordinatorTimePickerTheme}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <TimePicker
              ampm={false}
              disableOpenPicker
              open={pickerOpen}
              value={value ? dayjs(`2000-01-01T${value}`) : null}
              onClose={() => setPickerOpen(false)}
              onChange={(next) => onChange(next?.isValid() ? next.format("HH:mm") : "")}
              slotProps={{
                textField: {
                  id: fieldId,
                  fullWidth: true,
                  size: "small",
                  slotProps: {
                  input: {
                    "aria-labelledby": labelId,
                    onKeyDown: (event) => {
                      if (event.altKey && event.key === "ArrowDown") {
                        event.preventDefault();
                        setPickerOpen(true);
                      }
                    },
                  },
                  },
                },
                desktopPaper: {
                  sx: {
                    mt: 0.5,
                    minWidth: 208,
                    overflow: "hidden",
                    "&::before": {
                      content: "'Select time'",
                      display: "block",
                      borderBottom: "1px solid #d9dee7",
                      backgroundColor: "#f2f7fb",
                      px: 1.5,
                      py: 1,
                      color: "#1f4e79",
                      fontSize: "0.8125rem",
                      fontWeight: 700,
                    },
                    "& .MuiMultiSectionDigitalClock-root": {
                      backgroundColor: "#ffffff",
                      p: 0.5,
                    },
                    "& .MuiPickersActionBar-root": {
                      justifyContent: "space-between",
                      borderTop: "1px solid #d9dee7",
                      backgroundColor: "#f7f8fa",
                      px: 1.5,
                      py: 1,
                    },
                    "& .MuiPickersActionBar-root .MuiButton-root": {
                      borderRadius: 1,
                      px: 1.25,
                      py: 0.5,
                      color: "#1f4e79",
                      fontWeight: 700,
                    },
                  },
                },
                mobilePaper: { sx: { mx: 2 } },
                actionBar: {
                  sx: {
                    borderTop: "1px solid #e5e7eb",
                    px: 1,
                    py: 0.5,
                    "& .MuiButton-root": {
                      color: "#1f4e79",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      textTransform: "none",
                    },
                  },
                },
              }}
            />
          </LocalizationProvider>
        </ThemeProvider>
        {trailing}
      </div>
    </div>
  );
}
