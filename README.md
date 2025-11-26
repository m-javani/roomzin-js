# Roomzin Node.js SDK

Official Node.js SDK for [Roomzin](https://m-javani.github.io/roomzin-doc/) — a high-performance in-memory inventory engine for booking platforms.

The SDK provides a modern TypeScript API for communicating with Roomzin servers in both standalone and clustered deployments. It automatically manages routing, failover, connection pooling, and cluster topology changes.

---

## Features

- Automatic request routing (leader for writes, followers for reads)
- Built-in failover and cluster discovery
- Connection pooling
- Standalone and clustered deployment support
- Fully typed TypeScript API
- Promise-based asynchronous API
- Reusable, concurrency-safe client

---

## Requirements

- Node.js 18 or later
- Roomzin Server v1.x

---

## Installation

```bash
npm install roomzin-js
# or
yarn add roomzin-js
# or
pnpm add roomzin-js
```

---

## Client Setup

### Standalone

```typescript
import { SingleClient } from 'roomzin-js';

const client = await SingleClient.create({
    host: '127.0.0.1',
    tcpPort: 7777,
    authToken: 'abc123',
    timeout: 5000,        // 5 seconds
    keepAlive: 30000,     // 30 seconds
});

// Use client...
await client.close();
```

### Cluster (Static Discovery)

```typescript
import { ClusterClient, ClusterConfigBuilder } from 'roomzin-js';
import type { NodeAddr } from 'roomzin-js';

const staticDiscovery: NodeAddr[] = [
    { node_id: 'roomzin-0', addr: '172.20.0.10', tcp_port: 7777, api_port: 8080 },
    { node_id: 'roomzin-1', addr: '172.20.0.11', tcp_port: 7777, api_port: 8080 },
    { node_id: 'roomzin-2', addr: '172.20.0.12', tcp_port: 7777, api_port: 8080 },
];

const cfg = ClusterConfigBuilder.new()
    .withSeedNodeIds('roomzin-0,roomzin-1,roomzin-2')
    .withStaticDiscovery(staticDiscovery)
    .withAPIPort(8080)
    .withTCPPort(7777)
    .withToken('abc123')
    .withTimeout(5000)
    .withHttpTimeout(5000)
    .withKeepAlive(30000)
    .withMaxActiveConns(100)
    .build();

const client = await ClusterClient.create(cfg);
await client.close();
```

### Cluster (HTTP Discovery)

```typescript
const cfg = ClusterConfigBuilder.new()
    .withSeedNodeIds('roomzin-0,roomzin-1,roomzin-2')
    .withHTTPDiscovery('http://discovery-service:8080/nodes')
    .withAPIPort(8080)
    .withTCPPort(7777)
    .withToken('abc123')
    .withTimeout(5000)
    .withHttpTimeout(5000)
    .withKeepAlive(30000)
    .build();

const client = await ClusterClient.create(cfg);
```

---

## Discovery Configuration

Roomzin SDKs need to know how to reach each Roomzin node in the cluster. The cluster nodes communicate with each other using internal address resolvers, but the SDK as an external client needs actual network addresses (IP:port or hostname:port) to connect.

The SDK fetches the cluster topology from the Roomzin cluster itself. This topology includes the node identities of the leader and followers. The SDK then uses discovery to resolve these node identities into actual network addresses.

Two discovery modes are supported:

### Static Discovery

The SDK gets the mapping once in config and never updates it. Use this when your cluster nodes have stable, predictable addresses.

### HTTP Discovery

The SDK periodically fetches the mapping from an HTTP endpoint. Use this when cluster nodes are dynamic (e.g., Kubernetes pods with changing IPs).

---

## Property Management

### setProp
Adds or updates a property.

```typescript
await client.setProp({
    segment: 'downtown',
    area: 'manhattan',
    propertyID: 'hotel_123',
    propertyType: 'hotel',
    category: 'luxury',
    stars: 4,
    latitude: 40.7128,
    longitude: -74.0060,
    amenities: ['wifi', 'pool', 'gym'],
});
```

### searchProp
Searches properties by segment, area, type, or location.

```typescript
// By segment
const ids = await client.searchProp({ segment: 'downtown' });

// By area
const ids = await client.searchProp({
    segment: 'downtown',
    area: 'manhattan',
});

// By location (radius search)
const ids = await client.searchProp({
    segment: 'downtown',
    latitude: 40.7128,
    longitude: -74.0060,
});
```

### propExist
Checks if a property exists.

```typescript
const exists = await client.propExist('hotel_123');
```

### propRoomExist
Checks if a specific room type exists for a property.

```typescript
const exists = await client.propRoomExist({
    propertyID: 'hotel_123',
    roomType: 'suite',
});
```

### propRoomList
Lists all room types for a property.

```typescript
const rooms = await client.propRoomList('hotel_123');
```

### propRoomDateList
Lists dates with availability data for a property and room type.

```typescript
const dates = await client.propRoomDateList({
    propertyID: 'hotel_123',
    roomType: 'suite',
});
```

---

## Room Package Management

### setRoomPkg
Sets availability, price, and rate features for a room type on a date.

```typescript
await client.setRoomPkg({
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
    availability: 10,
    finalPrice: 199,
    rateFeature: ['free_cancellation', 'breakfast_included'],
});
```

### setRoomAvl
Sets exact availability for a room type on a specific date.

```typescript
const newAvail = await client.setRoomAvl({
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
    amount: 20,
});
```

### incRoomAvl
Increases availability (e.g., on cancellation).

```typescript
const newAvail = await client.incRoomAvl({
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
    amount: 1,
});
```

### decRoomAvl
Decreases availability (e.g., on booking).

```typescript
const newAvail = await client.decRoomAvl({
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
    amount: 2,
});
```

### getPropRoomDay
Gets availability and pricing for a specific room on a specific date.

```typescript
const day = await client.getPropRoomDay({
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
});
console.log(`Avail: ${day.availability}, Price: ${day.finalPrice}`);
```

---

## Search & Query

### searchAvail
Searches available rooms by filters.

```typescript
const results = await client.searchAvail({
    segment: 'downtown',
    roomType: 'suite',
    date: ['2026-07-20', '2026-07-21'],
    limit: 50,
    minPrice: 100,
    maxPrice: 300,
    amenities: ['wifi', 'pool'],
    rateFeature: ['free_cancellation'],
});

for (const result of results) {
    console.log(`Property: ${result.propertyID}`);
    for (const day of result.days) {
        console.log(`  ${day.date}: Avail ${day.availability}, Price ${day.finalPrice}`);
    }
}
```

### getSegments
Lists all active segments with their property counts.

```typescript
const segments = await client.getSegments();
for (const seg of segments) {
    console.log(`${seg.segment}: ${seg.count} properties`);
}
```

### getCodecs
Gets the current codec registry (used internally for validation).

```typescript
const codecs = await client.getCodecs();
console.log(codecs.rateFeatures);
```

---

## Delete Operations

### delRoomDay
Deletes availability for a specific room on a specific date.

```typescript
await client.delRoomDay({
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
});
```

### delPropDay
Deletes all data for a property on a specific date.

```typescript
await client.delPropDay({
    propertyID: 'hotel_123',
    date: '2026-07-20',
});
```

### delPropRoom
Deletes a room type from a property.

```typescript
await client.delPropRoom({
    propertyID: 'hotel_123',
    roomType: 'suite',
});
```

### delProp
Deletes an entire property.

```typescript
await client.delProp('hotel_123');
```

### delSegment
Deletes a segment and all properties within it.

```typescript
await client.delSegment('downtown');
```

---

## Error Handling

Every SDK operation may reject with a `RoomzinError`. Use the provided helper functions to classify errors:

```typescript
import { IsRequest, IsRetry, IsClient, IsInternal } from 'roomzin-js';

try {
    await client.setRoomPkg(payload);
} catch (err) {
    if (IsRequest(err)) {
        // Business rule violation - fix the request
        console.log('Request error:', err.code);
    } else if (IsRetry(err)) {
        // Temporary condition - retry with backoff
        await sleep(100);
        await client.setRoomPkg(payload);
    } else if (IsClient(err)) {
        // Authentication or protocol errors
        console.log('Client error:', err.message);
    } else if (IsInternal(err)) {
        // Unexpected server response
        throw new Error('Internal error', { cause: err });
    } else {
        // Fatal error
        throw err;
    }
}
```

### Error Categories

| Category | Description | Action |
|----------|-------------|--------|
| **Client** | Authentication or protocol errors | Check credentials and configuration |
| **Request** | Invalid input or business rule violation | Fix request, don't retry |
| **Retry** | Temporary server condition (429, 503, 308) | Retry with backoff |
| **Internal** | Unexpected server response | Log and investigate |

---

## Client Lifecycle

Create a **single client** during application startup and reuse it throughout your application.

```typescript
// ✅ Good - create once, reuse
const client = await SingleClient.create(config);
// Use client everywhere...
await client.close();

// ❌ Bad - creating per request
for (const req of requests) {
    const client = await SingleClient.create(config); // Don't do this
    await client.setRoomPkg(req);
    await client.close();
}
```

The client is safe for concurrent use and manages TCP connections internally.

---

## API Reference

For the complete interface definition, see [`src/api/client.ts`](src/api/client.ts). All types are documented with JSDoc comments.

---

## Documentation

For Roomzin concepts, deployment, and administration:

[https://m-javani.github.io/roomzin-doc/docs.html](https://m-javani.github.io/roomzin-doc/docs.html)

---

## Contributing

Contributions are welcome! Please open an issue before proposing large changes.

All contributions are subject to the BUSL-1.1 License terms.

---

## License

This SDK is licensed under the [BUSL-1.1 License](LICENSE).

**Note:** This SDK communicates with Roomzin Server, which requires a valid Roomzin license.

---

## Support

- **Documentation**: [roomzin-doc](https://m-javani.github.io/roomzin-doc/)
- **Community Q&A**: [GitHub Discussions](https://github.com/m-javani/roomzin-doc/discussions)
- **Issues**: [GitHub Issues](https://github.com/roomzin/roomzin-js/issues)
- **Security**: [mehdy.javany@gmail.com](mailto:mehdy.javany@gmail.com)

---

## Related Repositories

- [Roomzin Quickstart](https://github.com/m-javani/roomzin-quickstart) — Local Docker cluster
- [Roomzin Bench](https://github.com/m-javani/roomzin-bench) — Benchmarking tool

---