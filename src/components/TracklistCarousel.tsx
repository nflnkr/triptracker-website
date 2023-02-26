import { Box, IconButton } from "@mui/material";
import { useMemo } from "react";
import { ProcessedTrip } from "../types/models";
import { trackTypeIcons } from "../utils/trackTypeIcons";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import ArrowLeftIcon from "@mui/icons-material/ArrowLeft";


interface Props {
    trip: ProcessedTrip;
    selectedTrackIndex: number;
    setSelected: (index: number) => void;
    incrementSelected: () => void;
    decrementSelected: () => void;
}

// TODO wheel horizontal scroll
// TODO scroll to selected track
export default function TracklistCarousel({ trip, selectedTrackIndex, setSelected, incrementSelected, decrementSelected }: Props) {
    const left = ((trip.tracks.length - 1) / 2 - selectedTrackIndex) * 56;

    const trackTypeSequence = useMemo(() => trip?.tracks.map((track, index) => {
        const Icon = trackTypeIcons[track.type];
        return (
            <Box key={`${trip.startDate}${track.startDate}`} sx={{ m: 1 }}>
                <IconButton
                    color="inherit"
                    onClick={() => setSelected(index)}
                    sx={{
                        transform: selectedTrackIndex === index ? "scale(1.5)" : undefined,
                        /* left,
                        position: "relative",
                        transitionProperty: "left",
                        transitionDuration: "400ms", */
                    }}
                >
                    <Icon />
                </IconButton>
            </Box>
        );
    }), [selectedTrackIndex, setSelected, trip.startDate, trip?.tracks]);

    return (
        <Box sx={{ p: 0.5, display: "flex", width: "100%" }}>
            <IconButton onClick={decrementSelected} size="large" color="inherit">
                <ArrowLeftIcon fontSize="large" />
            </IconButton>
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "center",
                    overflowX: "auto",
                    overflowY: "hidden",
                    flexGrow: 1,
                    "::-webkit-scrollbar": {
                        display: "none"
                    }
                }}
            >
                {trackTypeSequence}
            </Box>
            <IconButton onClick={incrementSelected} size="large" color="inherit">
                <ArrowRightIcon fontSize="large" />
            </IconButton>
        </Box>
    );
}