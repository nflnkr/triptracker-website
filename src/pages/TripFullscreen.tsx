import {
    Alert,
    Box,
    Button,
    Checkbox,
    Container,
    Divider,
    FormControlLabel,
    IconButton,
    List,
    ListItem,
    ListItemAvatar,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Slider,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme
} from "@mui/material";
import Paper from "@mui/material/Paper";
import { useCallback, useContext, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ProcessedTrackPoint } from "../types/models";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import SpeedIcon from "@mui/icons-material/Speed";
import StraightenIcon from "@mui/icons-material/Straighten";
import type { ChartData } from "chart.js";
import {
    Chart as ChartJS,
    Tooltip as ChartTooltip,
    CategoryScale,
    Decimation,
    Legend,
    LinearScale,
    LineElement,
    PointElement,
    TimeScale,
    Title
} from "chart.js";
import "chartjs-adapter-date-fns";
import zoomPlugin from "chartjs-plugin-zoom";
import { Line } from "react-chartjs-2";
import { ChartJSOrUndefined } from "react-chartjs-2/dist/types";
import OlMap from "../components/OlMap";
import { chartjsOptions, verticalLineOnHoverPlugin } from "../utils/chartjs";
import { approximateIntermediatePoint, getChartData, toRawTrip, movingAverage, processTrip } from "../utils/trackDataCalcs";
import LoadingButton from "@mui/lab/LoadingButton";
import SaveIcon from "@mui/icons-material/Save";
import FastRewindIcon from "@mui/icons-material/FastRewind";
import FastForwardIcon from "@mui/icons-material/FastForward";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import TracklistItem from "../components/TracklistItem";
import PageLoading from "../components/PageLoading";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { setTrips, removeTrack, mergeTracks, splitTrack, renameTrip, cropTrack, deleteTrips, setTrip } from "../redux/tripsSlice";
import TracklistCarousel from "../components/TracklistCarousel";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import MergeIcon from "@mui/icons-material/Merge";
import DeleteIcon from "@mui/icons-material/Delete";
import CropIcon from "@mui/icons-material/Crop";
import GestureIcon from "@mui/icons-material/Gesture";
import { useInterval } from "../utils/hooks";
import TracklistPagination from "../components/TracklistPagination";
import GpsFixedIcon from "@mui/icons-material/GpsFixed";
import GpsNotFixedIcon from "@mui/icons-material/GpsNotFixed";

ChartJS.register(
    CategoryScale,
    LinearScale,
    TimeScale,
    PointElement,
    LineElement,
    Title,
    ChartTooltip,
    Legend,
    Decimation,
    zoomPlugin,
    verticalLineOnHoverPlugin,
);

type TripSaveState = "sending" | "success" | "error" | null;

const CHART_HEIGHT = 150;
const PLAYBACK_MAX_FPS = 30;
const PLAYBACK_MIN_FRAMETIME = 1000 / PLAYBACK_MAX_FPS;

const playbackSpeeds = [-2000, -1000, -500, -250, -125, -50, -25, -10, -5, -2, -1, 1, 2, 5, 10, 25, 50, 125, 250, 500, 1000, 2000] as const;
type PlaybackSpeed = typeof playbackSpeeds[number];

interface PlaybackState {
    playing: boolean;
    speed: PlaybackSpeed;
}
const initialPlaybackState: PlaybackState = { playing: false, speed: 1 };

const useTracklistPagination = true;

// TODO display 404/redirect for not existing trips
// TODO ability to create and draw track
// TODO hover on map near tracks highlights track on list
// TODO flex direction column on mobile
// TODO stop points as circles, text in which indicates stop time
// TODO react to aspect ratio
export default function TripPage() {
    const trips = useAppSelector(state => state.trips);
    const dispatch = useAppDispatch();
    const tripId = useParams().tripId;
    const trip = useMemo(() => trips.find(trip => trip._id === tripId), [tripId, trips]);
    const [chartData, setChartData] = useState<ChartData<"line"> | null>(null);
    const [highlightPoint, setHighlightPoint] = useState<ProcessedTrackPoint | null>(null);
    const [followOnChartHover, setFollowOnChartHover] = useState<boolean>(false);
    const [chartType, setChartType] = useState<"time" | "distance">("time");
    const [shownTracks, setShownTracks] = useState<number[]>([]);
    const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
    const [currentTrackProgress, setCurrentTrackProgress] = useState<number | null>(null);
    const [playbackState, setPlaybackState] = useState<PlaybackState>(initialPlaybackState);
    const [tripName, setTripName] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [tripSaveState, setTripSaveState] = useState<TripSaveState>(null);
    const [progressZoomTimeBoundaries, setProgressZoomTimeBoundaries] = useState<[number, number] | null>(null);
    const playbackAnimationReady = useRef<boolean>(true);
    const playbackAnimationTimeRef = useRef<number | null>(null);
    const navigate = useNavigate();
    const chartRef = useRef<ChartJSOrUndefined<"line"> & { currentTrackProgress: number; }>(null);
    const tripLoadedRef = useRef(false);
    const defferedTrackProgress = useDeferredValue(currentTrackProgress);
    const theme = useTheme();
    const isPortraitMode = useMediaQuery(theme.breakpoints.down("md"));
    const selectedTrack = trip?.tracks[selectedTrackIndex] || null;
    const trackProgressBoxRef = useRef<HTMLDivElement>();

    if (chartRef.current && currentTrackProgress !== null) chartRef.current.currentTrackProgress = currentTrackProgress;

    useInterval(function resizeProgressSlider() {
        if (!chartRef.current || !trackProgressBoxRef.current) return;

        trackProgressBoxRef.current.style.width = `${chartRef.current.chartArea.width}px`;
        trackProgressBoxRef.current.style.marginLeft = `${chartRef.current.chartArea.left}px`;
    }, 1000);

    useEffect(function handleNewTrip() {
        if (!trip?.tracks?.length) return;

        if (!tripLoadedRef.current) {
            tripLoadedRef.current = true;
            setShownTracks(trip.tracks.map((track, index) => index));
            setCurrentTrackProgress(trip.tracks[0].startDate);
            setTripName(trip.name);
        }
    }, [trip]);

    useEffect(function refreshChartData() {
        if (!trip || !selectedTrack || !trip.tracks.length) return setChartData(null);

        const data: ChartData<"line"> = {
            datasets: [
                {
                    label: "Speed, km/h",
                    data: movingAverage(getChartData(selectedTrack, "speed", chartType), 4),
                    borderColor: "rgb(255, 99, 132)",
                    backgroundColor: "rgba(255, 99, 132, 0.5)",
                    yAxisID: "y",
                },
                {
                    label: "Elevation, m",
                    data: movingAverage(getChartData(selectedTrack, "elevation", chartType), 2),
                    borderColor: "rgb(53, 162, 235)",
                    backgroundColor: "rgba(53, 162, 235, 0.5)",
                    yAxisID: "y1",
                },
            ],
        };

        setChartData(data);
        chartRef.current?.resetZoom();
    }, [chartType, selectedTrack, trip]);

    useEffect(function resetTrackProgress() {
        if (!trip || !selectedTrack || !trip.tracks.length) return;

        setCurrentTrackProgress(selectedTrack.startDate);
        setProgressZoomTimeBoundaries([selectedTrack.startDate, selectedTrack.endDate]);
    }, [selectedTrack, trip]);

    /* useEffect(function refreshShownTracks() {
        if (!trip) return;

        setShownTracks(prevShownTracks => {
            const newShownTracks: boolean[] = [];
            for (let i = 0; i < trip.tracks.length; i++) {
                newShownTracks[i] = prevShownTracks[i] !== undefined ? prevShownTracks[i] : true;
            }
            return newShownTracks;
        });
        if (!trip.tracks.length) {
            setSelectedTrackIndex(0);
            setCurrentTrackProgress(null);
        }
    }, [trip]); */

    useEffect(function handlePlaybackAnimation() {
        if (!trip || !selectedTrack) return;

        if (playbackState.playing) {
            if (!playbackAnimationReady.current) return;

            playbackAnimationReady.current = false;
            const timestamp = Date.now();
            if (playbackAnimationTimeRef.current === null) playbackAnimationTimeRef.current = timestamp;
            let dt = timestamp - playbackAnimationTimeRef.current;
            playbackAnimationTimeRef.current = timestamp;

            setTimeout(() => {
                playbackAnimationReady.current = true;
                setCurrentTrackProgress(prev => {
                    return prev ? prev + dt * playbackState.speed + 1 : prev;
                });
            }, PLAYBACK_MIN_FRAMETIME);
        } else {
            playbackAnimationTimeRef.current = null;
            playbackAnimationReady.current = true;
        }
    }, [playbackState, selectedTrack, trip, defferedTrackProgress]);

    useEffect(function approximateHighlightPoint() {
        if (defferedTrackProgress === null) return;
        if (!selectedTrack) return setHighlightPoint(null);

        if (defferedTrackProgress > selectedTrack.endDate) {
            setPlaybackState(prev => ({ ...prev, playing: false }));
            setCurrentTrackProgress(selectedTrack.startDate);
        } else {
            const trkptIndex = selectedTrack.trackpoints.findIndex(trackpoint => trackpoint.time >= defferedTrackProgress);
            const trkpt2 = selectedTrack.trackpoints[trkptIndex];
            if (trkptIndex < 1) return setHighlightPoint(trkpt2);
            const trkpt1 = selectedTrack.trackpoints[trkptIndex - 1];
            const progress = (defferedTrackProgress - trkpt1.time) / (trkpt2.time - trkpt1.time);
            const trkpt = approximateIntermediatePoint(trkpt1, trkpt2, progress);
            setHighlightPoint(trkpt);
        }
    }, [defferedTrackProgress, selectedTrack]);

    /* useEffect(function changeTripName() {
        if (!tripName || !trip || !tripName) return;

        dispatch(renameTrip({ tripId: trip._id, tripName }));
    }, [dispatch, trip, tripName]); */

    useEffect(function drawVerticalLineOnChart() {
        if (!chartRef.current || defferedTrackProgress === null) return;

        chartRef.current.update();
    }, [defferedTrackProgress, progressZoomTimeBoundaries]);

    /* useEffect(function refreshChartAreaDims() {
        setTimeout(() => {
            if (!chartRef.current?.chartArea) return setChartAreaDims({ width: "auto", left: "0" });

            setChartAreaDims({ width: `${chartRef.current.chartArea.width}px`, left: `${chartRef.current.chartArea.left}px` });
        }, 100);
    }, [chartData, isEditing, progressZoomTimeBoundaries]); */

    useEffect(function reactToTrackProgressOutOfBounds() {
        if (!progressZoomTimeBoundaries || !defferedTrackProgress) return;
        // TODO change
        /* if (progressZoomTimeBoundaries[0] > defferedTrackProgress) setProgressZoomTimeBoundaries([
            defferedTrackProgress,
            defferedTrackProgress + progressZoomTimeBoundaries[1] - progressZoomTimeBoundaries[0]
        ]);
        if (progressZoomTimeBoundaries[1] < defferedTrackProgress) setProgressZoomTimeBoundaries([
            defferedTrackProgress,
            defferedTrackProgress + progressZoomTimeBoundaries[1] - progressZoomTimeBoundaries[0]
        ]); */
    }, [defferedTrackProgress, progressZoomTimeBoundaries]);

    useEffect(function zoomScaleChart() {
        if (!chartRef || !progressZoomTimeBoundaries) return;

        chartRef.current?.zoomScale("x", { min: progressZoomTimeBoundaries[0], max: progressZoomTimeBoundaries[1] });
    }, [progressZoomTimeBoundaries]);

    useEffect(function stopPlaybackWhenEditing() {
        if (isEditing) setPlaybackState(prev => ({ ...prev, playing: false }));
    }, [isEditing]);

    const handleToggle = (index: number) => () => {
        setShownTracks(prev =>
            prev.includes(index) ? prev.filter(trackIndex => trackIndex !== index) : [...prev, index].sort((a, b) => a - b));
    };

    function chartResetZoom() {
        if (!chartRef.current) return;
        chartRef.current.resetZoom();
    }

    function handleChartTypeChange(e: unknown, newChartType: "time" | "distance") {
        if (newChartType) setChartType(newChartType);
    }

    function handleTrackProgressChange(e: unknown, newValue: number | number[]) {
        if (!trip || !selectedTrack) return;
        requestAnimationFrame(() => {
            setCurrentTrackProgress(newValue as number);
        });
    }

    function handlePlaybackButton() {
        setPlaybackState(prev => ({ ...prev, playing: !prev.playing }));
    }

    function handlePlaybackSpeedDecrease() {
        setPlaybackState(prev => {
            let currentSpeedIndex = playbackSpeeds.indexOf(prev.speed) - 1;
            if (currentSpeedIndex < 0) currentSpeedIndex = 0;
            return { ...prev, speed: playbackSpeeds[currentSpeedIndex] };
        });
    }

    function handlePlaybackSpeedIncrease() {
        setPlaybackState(prev => {
            let currentSpeedIndex = playbackSpeeds.indexOf(prev.speed) + 1;
            if (currentSpeedIndex > playbackSpeeds.length - 1) currentSpeedIndex = playbackSpeeds.length - 1;
            return { ...prev, speed: playbackSpeeds[currentSpeedIndex] };
        });
    }

    const chartOptions = useMemo(() => chartjsOptions({
        type: chartType,
        onZoomOrPanComplete: (context) => {
            const min = context.chart.scales["x"].min;
            const max = context.chart.scales["x"].max;

            if ((context.chart as any).currentTrackProgress < min) setCurrentTrackProgress(min);
            if ((context.chart as any).currentTrackProgress > max) setCurrentTrackProgress(min);
            setProgressZoomTimeBoundaries([min, max]);
        }
    }), [chartType]);

    const trackEditButtons = useMemo(() => {
        if (!isEditing) return;

        function handleSplitTrack() {
            if (!highlightPoint || !tripId) return;

            dispatch(splitTrack({ tripId, trackIndex: selectedTrackIndex, time: highlightPoint.time }));
        }

        function handleMergeSelectedTracks() {
            if (!tripId) return;

            dispatch(mergeTracks({ tripId, trackIndexes: shownTracks }));
            setSelectedTrackIndex(shownTracks[0]);
        }

        function handleDeleteSelectedTracks() {
            if (!tripId) return;

            dispatch(removeTrack({ tripId, trackIndexes: shownTracks }));
        }

        function handleCropSelectedTrack() {
            if (!progressZoomTimeBoundaries || !tripId) return;

            dispatch(cropTrack({ tripId, trackIndex: selectedTrackIndex, start: progressZoomTimeBoundaries[0], end: progressZoomTimeBoundaries[1] }));
        }

        function handleDrawTrack() {
            // Enable draw mode, when "done" button clicked get coordinates and create new track and add to trip
        }

        return true ? (
            <Box sx={{ display: "flex", gap: 1, p: 1 }}>
                <Tooltip title="Split">
                    <IconButton onClick={handleSplitTrack} size="small">
                        <ContentCutIcon />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Merge">
                    <IconButton onClick={handleMergeSelectedTracks} size="small">
                        <MergeIcon />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Crop">
                    <IconButton onClick={handleCropSelectedTrack} size="small">
                        <CropIcon />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                    <IconButton onClick={handleDeleteSelectedTracks} size="small">
                        <DeleteIcon />
                    </IconButton>
                </Tooltip>
                {/* <Tooltip title="Draw">
                    <IconButton onClick={handleDrawTrack} size="small">
                        <GestureIcon />
                    </IconButton>
                </Tooltip> */}
            </Box>
        ) : (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, p: 1 }}>
                <Button onClick={handleSplitTrack} sx={{ flex: "1 1 40%" }} size="small" variant="contained">Split</Button>
                <Button onClick={handleMergeSelectedTracks} sx={{ flex: "1 1 40%" }} size="small" variant="contained">Merge</Button>
                <Button onClick={handleDeleteSelectedTracks} sx={{ flex: "1 1 40%" }} size="small" variant="contained">Delete</Button>
                <Button onClick={handleCropSelectedTrack} sx={{ flex: "1 1 40%" }} size="small" variant="contained">Crop</Button>
                <Button disabled onClick={handleDrawTrack} sx={{ flex: "1 1 40%" }} size="small" variant="contained">Draw</Button>
            </Box>
        );
    }, [dispatch, highlightPoint, isEditing, progressZoomTimeBoundaries, selectedTrackIndex, shownTracks, tripId]);

    const tripMetadata = useMemo(() => {
        if (!trip) return;

        return (
            <Box sx={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between"
            }}>
                {[
                    ["Start date", trip.startDate !== null ? new Date(trip.startDate).toLocaleDateString() : "No data", <CalendarMonthIcon />],
                    ["Start time", trip.startDate !== null ? new Date(trip.startDate).toLocaleTimeString() : "No data", <AccessTimeIcon />],
                    ["Distance", trip.totalDistance !== null ? (trip.totalDistance / 1000).toFixed(3) + " km" : "No data", <StraightenIcon />],
                    ["Max speed", trip.maxSpeed !== null ? trip.maxSpeed.toFixed(1) + " km/h" : "No data", <SpeedIcon />],
                ].map(tripData => (
                    <ListItem key={tripData[0] as string} sx={{ flex: "1 1 0", minWidth: "fit-content" }}>
                        <ListItemAvatar sx={{ minWidth: 40 }} >
                            {tripData[2]}
                        </ListItemAvatar>
                        <ListItemText sx={{ my: 0 }} primary={tripData[0]} secondary={tripData[1]} />
                    </ListItem>
                ))}
            </Box>
        );
    }, [trip]);

    const tripControls = useMemo(() => {
        if (!trip) return;

        async function handleTripDeleteClick() {
            if (!tripId) return;
            // TODO handle errors
            try {
                const response = await fetch("/api/trip/" + tripId, {
                    method: "delete",
                    credentials: "include"
                });
                const result = await response.json();
                if (result.success) {
                    dispatch(deleteTrips([tripId]));
                    navigate("/trips");
                } else {
                    // TODO
                    console.log("Trip delete failed", result);
                }
            } catch (error) {
                console.log("Trip delete failed", error);
            }
        }

        function handleEditClick() {
            setIsEditing(true);
            setTripSaveState(null);
        }

        async function handleCancelClick() {
            if (!tripId) return;

            setIsEditing(false);
            setShownTracks(trip?.tracks.map((track, index) => index) || []);
            try {
                const response = await fetch("/api/trip/" + tripId, { credentials: "include" });
                const result = await response.json();
                if (result.success) {
                    dispatch(setTrip({ tripId, trip: processTrip(result.trip) }));
                } else {
                    // TODO
                    console.log("Error fetching trip", result);
                }
            } catch (error) {
                console.log("Error fetching trip", error);
            }
        }

        async function handleSaveClick() {
            if (!trip || !tripId || tripName === null) return;
            // TODO handle errors
            setTripSaveState("sending");
            try {
                const rawTrip = toRawTrip(trip);
                rawTrip.name = tripName;

                const response = await fetch("/api/trip/" + tripId, {
                    method: "PATCH",
                    credentials: "include",
                    headers: {
                        "Accept": "application/json, text/plain, */*",
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ trip: rawTrip })
                });
                const result = await response.json();
                console.log("trip upload result:", result);
                if (result.success) {
                    // TODO
                    setTripSaveState("success");
                    setIsEditing(false);
                    dispatch(renameTrip({ tripId, tripName }));
                } else {
                    // TODO
                    console.log("Trip save failed", result);
                    setTripSaveState("error");
                }
            } catch (error) {
                console.log("trip update error:", error);
                setTripSaveState("error");
            }
        }

        function handleTripNameChange(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
            // TODO validate name
            setTripName(event.target.value);
        }

        return (
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                <Box sx={{ flexGrow: 1 }}>
                    {isEditing ?
                        <TextField
                            value={tripName}
                            onChange={handleTripNameChange}
                            variant="standard"
                            InputProps={{
                                sx: {
                                    fontSize: "2.125rem",
                                    height: "1.235em"
                                }
                            }}
                        />
                        :
                        <Typography variant="h4">{tripName}</Typography>
                    }
                </Box>
                {tripSaveState === "success" &&
                    <Alert severity={tripSaveState}>Trip saved successfully!</Alert>
                }
                {tripSaveState === "error" &&
                    <Alert severity={tripSaveState}>Couldn"t save trip!</Alert>
                }
                {isEditing ?
                    <>
                        <LoadingButton
                            color="primary"
                            onClick={handleSaveClick}
                            loading={tripSaveState === "sending"}
                            loadingPosition="start"
                            startIcon={<SaveIcon />}
                            variant="contained"
                        >
                            Save
                        </LoadingButton>
                        <Button variant="contained" color="error" onClick={handleTripDeleteClick}>Delete</Button>
                        <Button variant="contained" onClick={handleCancelClick}>Cancel</Button>
                    </>
                    :
                    <Button variant="contained" onClick={handleEditClick}>Edit</Button>
                }
            </Box>
        );
    }, [dispatch, isEditing, navigate, trip, tripId, tripName, tripSaveState]);

    const trackControls = useMemo(() => {
        if (!selectedTrack) return;

        return (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                <IconButton onClick={handlePlaybackSpeedDecrease}>
                    <FastRewindIcon color={playbackState.speed < 0 ? "success" : undefined} />
                </IconButton>
                <IconButton sx={{ minWidth: "4em" }} color="primary" onClick={handlePlaybackButton}>
                    {playbackState.playing ?
                        <PauseCircleIcon fontSize="large" />
                        :
                        <PlayCircleIcon fontSize="large" />
                    }
                    <Typography>
                        {`x${Math.abs(playbackState.speed)}`}
                    </Typography>
                </IconButton>
                <IconButton onClick={handlePlaybackSpeedIncrease}>
                    <FastForwardIcon color={playbackState.speed > 0 ? "success" : undefined} />
                </IconButton>
                {followOnChartHover ?
                    <IconButton onClick={() => setFollowOnChartHover(false)} color="inherit" >
                        <GpsFixedIcon />
                    </IconButton>
                    :
                    <IconButton onClick={() => setFollowOnChartHover(true)} color="inherit" >
                        <GpsNotFixedIcon />
                    </IconButton>
                }
                {/* <ToggleButtonGroup
                    exclusive
                    value={chartType}
                    onChange={handleChartTypeChange}
                    size="small"
                >
                    <ToggleButton value={"time"}>Time</ToggleButton>
                    <ToggleButton value={"distance"}>Distance</ToggleButton>
                </ToggleButtonGroup> */}
            </Box>
        );
    }, [followOnChartHover, playbackState.playing, playbackState.speed, selectedTrack]);

    const tracklist = useMemo(() => {
        if (!trip) return;

        function incrementSelectedTrackIndex() {
            if (!trip) return;
            setSelectedTrackIndex(prev => {
                let newIndex = prev + 1;
                if (newIndex > trip.tracks.length - 1) newIndex = 0;
                return newIndex;
            });
        }
        function decrementSelectedTrackIndex() {
            if (!trip) return;
            setSelectedTrackIndex(prev => {
                let newIndex = prev - 1;
                if (newIndex < 0) newIndex = trip.tracks.length - 1;
                return newIndex;
            });
        }

        return useTracklistPagination ? (
            <TracklistPagination
                trip={trip}
                selectedTrackIndex={selectedTrackIndex}
                setSelected={index => setSelectedTrackIndex(index)}
            />
        ) : (
            <TracklistCarousel
                trip={trip}
                selectedTrackIndex={selectedTrackIndex}
                setSelected={index => setSelectedTrackIndex(index)}
                incrementSelected={incrementSelectedTrackIndex}
                decrementSelected={decrementSelectedTrackIndex}
            />
        );
    }, [selectedTrackIndex, trip]);

    if (!trip) return <PageLoading />;

    const oldUi = (
        <Container maxWidth={"xl"}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {tripControls}
                <Box sx={{ display: "flex", gap: 2, flexDirection: isPortraitMode ? "column" : "row" }}>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: "19em", flexGrow: 1, order: isPortraitMode ? 2 : 1 }}>
                        <Paper elevation={3} >
                            <OlMap
                                tripId={tripId}
                                tracks={trip.tracks}
                                shownTracks={shownTracks}
                                highlightPoint={highlightPoint}
                                followPoint={followOnChartHover}
                                isModify={isEditing}
                                selectedTrackIndex={selectedTrackIndex}
                            />
                        </Paper>
                        {trackControls}
                    </Box>
                    <Box sx={{ order: isPortraitMode ? 1 : 2, flexBasis: 0, minWidth: "19em" }}>
                        <Paper elevation={3} >
                            <Box sx={{ display: "flex", flexDirection: "column", alignItems: isPortraitMode ? undefined : "center" }}>
                                {!isEditing && tripMetadata}
                                {!isEditing && <Divider />}
                                {trackEditButtons}
                                {trackEditButtons && <Divider />}
                                {tracklist}
                            </Box>
                        </Paper>
                    </Box>
                </Box>
            </Box>
        </Container >
    );

    const gridTemplateAreas = isPortraitMode ?
        `
        "tracklist"
        "map"
        "metadata"
        `
        :
        `
        "map tracklist"
        "map metadata"
        `;

    const gridTemplateColumns = isPortraitMode ? "" : "1fr 400px";
    const gridTemplateRows = isPortraitMode ? "auto 1fr auto" : "";

    return (
        <Container
            maxWidth={false}
            disableGutters
            sx={{
                height: "100%",
                display: "grid",
                gridTemplateAreas,
                gridTemplateColumns,
                gridTemplateRows,
                justifyItems: "center",
                alignItems: "center"
            }}
        >
            <Box sx={{ height: "100%", width: "100%", gridArea: "map" }}>
                <OlMap
                    tripId={tripId}
                    tracks={trip.tracks}
                    shownTracks={shownTracks}
                    highlightPoint={highlightPoint}
                    followPoint={followOnChartHover}
                    isModify={isEditing}
                    selectedTrackIndex={selectedTrackIndex}
                />
            </Box>
            <Box sx={{ p: 1, height: "100%", width: "100%", backgroundColor: "rgba(0,0,255,0.1)", gridArea: "tracklist", minWidth: 0 }}>
                {tracklist}
                {trackControls}
            </Box>
            <Box sx={{ p: "10px", overflow: "hidden", height: "100%", width: "100%", backgroundColor: "rgba(0,255,0,0.1)", gridArea: "metadata" }}>
                {chartData && progressZoomTimeBoundaries && selectedTrack !== null &&
                    <Box>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <IconButton onClick={chartResetZoom}>
                                <RestartAltIcon />
                            </IconButton>
                            <Slider
                                value={progressZoomTimeBoundaries}
                                step={10}
                                min={selectedTrack.startDate}
                                max={selectedTrack.endDate}
                                sx={{
                                    "& .MuiSlider-thumb, & .MuiSlider-track": {
                                        transition: "none",
                                    },
                                    "& .MuiSlider-thumb": {
                                        borderRadius: "4px",
                                        width: "6px"
                                    }
                                }}
                                onChange={e => setProgressZoomTimeBoundaries((e as any).target.value)}
                            />
                        </Box>
                        <Box
                            ref={trackProgressBoxRef}
                            sx={{
                                transitionProperty: "all",
                                transitionDuration: `200ms`,
                                transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)"
                            }}
                        >
                            <Slider
                                value={currentTrackProgress as number}
                                step={10}
                                min={progressZoomTimeBoundaries[0]}
                                max={progressZoomTimeBoundaries[1]}
                                onChange={handleTrackProgressChange}
                                sx={{
                                    "& .MuiSlider-thumb, & .MuiSlider-track": {
                                        transition: "none",
                                    },
                                    zIndex: 1,
                                }}
                            />
                        </Box>
                        <Box position="relative" sx={{ height: CHART_HEIGHT, top: "-25px", mb: "-25px" }}>
                            <Line ref={chartRef} options={chartOptions} data={chartData} />
                        </Box>
                    </Box>
                }
            </Box>
        </Container>
    );
}
