using Xunit;

// These are integration tests sharing one Postgres database (tangram_test);
// each test class truncates it in InitializeAsync, so different classes
// running concurrently would stomp on each other's data.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
