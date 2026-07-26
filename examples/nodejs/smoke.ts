// smoke.ts - Roomzin Node.js SDK API Usage Example & Implicit Test
// Run with: npx ts-node smoke.ts

import { SingleClient, ClusterClient, ClusterConfigBuilder, RoomzinError, IsRetry } from 'roomzin-js';
import type { NodeAddr } from 'roomzin-js';
import { setTimeout } from 'node:timers/promises';

// ============================================================================
// CONFIGURATION - Change these to match your environment
// ============================================================================

// Change this to "standalone" to test against a single Roomzin instance
const MODE: string = 'standalone';

// Standalone configuration
const STANDALONE_HOST: string = '127.0.0.1';
const STANDALONE_PORT: number = 7777;
const TOKEN: string = 'abc123';
const TIMEOUT: number = 5000; // milliseconds

// Cluster configuration (update these IPs to match your cluster)
const STATIC_DISCOVERY: NodeAddr[] = [
    { node_id: 'roomzin-0', addr: '172.20.0.10', tcp_port: 7777, api_port: 8080 },
    { node_id: 'roomzin-1', addr: '172.20.0.11', tcp_port: 7777, api_port: 8080 },
    { node_id: 'roomzin-2', addr: '172.20.0.12', tcp_port: 7777, api_port: 8080 },
];

// Test data parameters
const NUM_SEGMENTS: number = 2;
const NUM_PROPS_PER_SEGMENT: number = 1000;
const NUM_ROOMS_PER_PROP: number = 2;
const NUM_DAYS: number = 3;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateDates(count: number): string[] {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 1; i <= count; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        dates.push(date.toISOString().split('T')[0]);
    }
    return dates;
}

async function waitForCondition(timeoutMs: number, conditionFn: () => Promise<boolean>): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await conditionFn()) {
            return;
        }
        await setTimeout(50);
    }
    throw new Error(`Condition not met within ${timeoutMs}ms`);
}

// ============================================================================
// CLIENT CREATION
// ============================================================================

async function createClient() {
    if (MODE.toLowerCase() === 'standalone') {
        return await SingleClient.create({
            host: STANDALONE_HOST,
            tcpPort: STANDALONE_PORT,
            authToken: TOKEN,
            timeout: TIMEOUT,
            keepAlive: 30000,
        });
    }

    // Cluster mode
    const cfg = ClusterConfigBuilder.new()
        .withSeedNodeIds('roomzin-0,roomzin-1,roomzin-2')
        .withStaticDiscovery(STATIC_DISCOVERY)
        .withAPIPort(8080)
        .withTCPPort(7777)
        .withToken(TOKEN)
        .withTimeout(30000)
        .withKeepAlive(30000)
        .build();

    return await ClusterClient.create(cfg);
}

// ============================================================================
// MAIN - CLEAR LINEAR FLOW
// ============================================================================

async function main(): Promise<void> {
    console.log('=== Roomzin API Example ===');
    console.log(`Mode: ${MODE}`);
    console.log();

    let client: Awaited<ReturnType<typeof createClient>> | undefined;

    try {
        // -------------------------------------------------------------------------
        // STEP 1: Connect to Roomzin
        // -------------------------------------------------------------------------
        console.log('[1/8] Connecting to Roomzin...');
        client = await createClient();
        console.log('  Connected successfully!');

        // -------------------------------------------------------------------------
        // STEP 2: Create properties and verify existence
        // -------------------------------------------------------------------------
        console.log('[2/8] SetProp...');

        const createdProps: string[] = [];
        const dates = generateDates(NUM_DAYS);

        for (let s = 1; s <= NUM_SEGMENTS; s++) {
            const segment = `seg_${s}`;
            for (let p = 1; p <= NUM_PROPS_PER_SEGMENT; p++) {
                const propId = `seg_${s}_p${p}`;

                await client.setProp({
                    segment: segment,
                    area: 'area_1',
                    propertyID: propId,
                    propertyType: 'hotel',
                    category: 'midrange',
                    stars: 3,
                    latitude: 40.7128 + p * 0.001,
                    longitude: -74.0060 + p * 0.001,
                    amenities: ['wifi', 'pool'],
                });

                createdProps.push(propId);
            }
        }

        // Check PropExist
        const p1 = createdProps[createdProps.length - 1];
        await waitForCondition(2000, async () => await client!.propExist(p1));
        console.log(`  ✓ All properties created, verified ${p1} exists`);

        // -------------------------------------------------------------------------
        // STEP 3: Set room packages and verify rooms/dates
        // -------------------------------------------------------------------------
        console.log('[3/8] SetRoomPkg...');

        for (let s = 1; s <= NUM_SEGMENTS; s++) {
            for (let p = 1; p <= NUM_PROPS_PER_SEGMENT; p++) {
                const propId = `seg_${s}_p${p}`;

                for (let r = 1; r <= NUM_ROOMS_PER_PROP; r++) {
                    const roomType = `room_${r}`;

                    for (const date of dates) {
                        const avail = 10 + p;
                        const price = 100 + p * 10;
                        const rateFeatures = ['free_cancellation', 'free_wifi'];

                        await client.setRoomPkg({
                            propertyID: propId,
                            roomType: roomType,
                            date: date,
                            availability: avail,
                            finalPrice: price,
                            rateFeature: rateFeatures,
                        });
                    }
                }
            }
        }

        // Verify room lists for first property
        const testProp = 'seg_1_p1';
        const rooms = await client.propRoomList(testProp);
        const expectedRooms = ['room_1', 'room_2'].sort();
        const sortedRooms = [...rooms].sort();

        if (JSON.stringify(sortedRooms) !== JSON.stringify(expectedRooms)) {
            throw new Error(`Expected ${expectedRooms} rooms, got ${rooms}`);
        }
        console.log(`  ✓ Room list verified: ${rooms}`);

        // Verify date lists for first room
        const testRoom = 'room_1';
        const dateList = await client.propRoomDateList({
            propertyID: testProp,
            roomType: testRoom,
        });

        if (dateList.length !== NUM_DAYS) {
            throw new Error(`Expected ${NUM_DAYS} dates, got ${dateList.length}`);
        }
        console.log(`  ✓ Date list verified: ${dateList}`);

        // Spot check: get a specific room/day
        const spotCheck = await client.getPropRoomDay({
            propertyID: testProp,
            roomType: testRoom,
            date: dates[0],
        });
        console.log(`  ✓ Spot check: room/day exists with avail=${spotCheck.availability}, price=${spotCheck.finalPrice}`);

        // -------------------------------------------------------------------------
        // STEP 4: Test SetRoomAvl, IncRoomAvl, DecRoomAvl
        // -------------------------------------------------------------------------
        console.log('[4/8] Update Availability...');

        const testDate = dates[0];

        // Get initial availability
        const initial = await client.getPropRoomDay({
            propertyID: testProp,
            roomType: testRoom,
            date: testDate,
        });
        console.log(`  GetPropRoomDay: avail=${initial.availability}, price=${initial.finalPrice}`);

        // SetRoomAvl
        const newAvail = 20;
        const setResult = await client.setRoomAvl({
            propertyID: testProp,
            roomType: testRoom,
            date: testDate,
            amount: newAvail,
        });
        console.log(`  SetRoomAvl: ${initial.availability} → ${setResult}`);

        // IncRoomAvl
        const incResult = await client.incRoomAvl({
            propertyID: testProp,
            roomType: testRoom,
            date: testDate,
            amount: 1,
        });
        console.log(`  IncRoomAvl: ${newAvail} → ${incResult}`);

        // DecRoomAvl
        const decResult = await client.decRoomAvl({
            propertyID: testProp,
            roomType: testRoom,
            date: testDate,
            amount: 1,
        });
        console.log(`  DecRoomAvl: ${incResult} → ${decResult}`);

        // -------------------------------------------------------------------------
        // STEP 5: Search availability and verify results
        // -------------------------------------------------------------------------
        console.log('[5/8] SearchAvail...');

        const limit = 100;
        const maxPrice = 150;

        const results = await client.searchAvail({
            segment: 'seg_1',
            roomType: 'room_1',
            date: [dates[0]],
            finalPrice: maxPrice,
            limit: limit,
            amenities: [],
            rateFeature: []
        });

        console.log(`  Found ${results.length} properties with max price ${maxPrice}`);

        if (results.length === 0) {
            throw new Error('Expected at least one search result');
        }

        // -------------------------------------------------------------------------
        // STEP 6: Test deletion commands (in sequence)
        // -------------------------------------------------------------------------
        console.log('[6/8] Deletion commands...');

        // 6.1: DelRoomDay
        console.log('  DelRoomDay...');
        await client.delRoomDay({
            propertyID: testProp,
            roomType: testRoom,
            date: testDate,
        });

        // Verify date was removed
        await waitForCondition(2000, async () => {
            const updatedDateList = await client!.propRoomDateList({
                propertyID: testProp,
                roomType: testRoom,
            });
            return !updatedDateList.includes(testDate);
        });
        console.log('  ✓ Date removed successfully');

        // 6.2: DelPropRoom
        console.log('  DelPropRoom...');
        await client.delPropRoom({
            propertyID: testProp,
            roomType: testRoom,
        });

        // Verify room was removed
        await waitForCondition(2000, async () => {
            const exists = await client!.propRoomExist({
                propertyID: testProp,
                roomType: testRoom,
            });
            return !exists;
        });
        console.log('  ✓ Room removed successfully');

        // 6.3: DelProp
        console.log('  DelProp...');
        await client.delProp(testProp);

        // Verify property was removed
        await waitForCondition(2000, async () => {
            const exists = await client!.propExist(testProp);
            return !exists;
        });
        console.log('  ✓ Property removed successfully');

        // 6.4: DelSegment
        console.log('  DelSegment...');
        await client.delSegment('seg_1');

        // Verify segment was removed
        await waitForCondition(2000, async () => {
            const props = await client!.searchProp({ segment: 'seg_1' });
            return props.length === 0;
        });
        console.log('  ✓ Segment removed successfully');

        // -------------------------------------------------------------------------
        // STEP 7: Clean up remaining data
        // -------------------------------------------------------------------------
        console.log('[7/7] Cleaning up...');

        try {
            await client.delSegment('seg_2');
            console.log('  Cleaned up seg_2');
        } catch (e) {
            const error = e as Error;
            console.log(`  Warning: Failed to delete seg_2: ${error.message}`);
        }

        console.log();
        console.log('✅ All completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', (error as Error).message);
        console.error((error as Error).stack);
        process.exit(1);
    } finally {
        if (client) {
            await client.close();
        }
        // Force exit after cleanup
        process.exit(0);
    }
}

// Run the main function
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});