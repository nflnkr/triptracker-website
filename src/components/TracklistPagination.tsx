import { Box, Typography } from "@mui/material";
import { ProcessedTrip } from "../types/models";
import { trackTypeIcons } from "../utils/trackTypeIcons";
import Pagination from "@mui/material/Pagination";
import PaginationItem from "@mui/material/PaginationItem";
import { useMemo } from "react";


const isPaginationMode = true;

interface Props {
    trip: ProcessedTrip;
    selectedTrackIndex: number;
    setSelected: (index: number) => void;
}

export default function TracklistPagination({ trip, selectedTrackIndex, setSelected }: Props) {
    const trackDateStrings = useMemo(
        () => {
            return trip?.tracks.map(track => {
                const date = formatTimeHHMM(track.endDate - track.startDate);
                return date;
            });
        },
        [trip?.tracks]
    );
    const paginationIcon = useMemo(
        () => trip?.tracks.map((track, index) => {
            const Icon = trackTypeIcons[track.type];
            return (
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <Icon />
                    <Typography variant="subtitle2" >{trackDateStrings[index]}</Typography>
                </Box>
            );
        }),
        [trackDateStrings, trip?.tracks]
    );

    return (
        <Box sx={{ display: "flex", width: "100%" }}>
            <Pagination
                size="small"
                shape="rounded"
                sx={{
                    width: "100%",
                    "& > ul": {
                        justifyContent: "center",
                        "& > li": {
                            flexGrow: 1
                        }
                    }
                }}
                count={trip?.tracks.length}
                page={selectedTrackIndex + 1}
                renderItem={item => (
                    <PaginationItem
                        sx={{
                            height: "48px",
                            width: "100%",
                            p: 0,
                            m: 0
                        }}
                        {...item}
                        onClick={() => setSelected((item.page || 1) - 1)}
                        page={paginationIcon[(item.page || 1) - 1]}
                    />
                )}
            />
        </Box>
    );
};

function formatTimeHHMM(time: number) {
    const sec_num = Math.floor(time / 1000);
    const hours = Math.floor(sec_num / 3600);
    const minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    let result = "";
    if (hours) result += hours + "h";
    if (minutes) result += minutes + "m";
    return result;
}