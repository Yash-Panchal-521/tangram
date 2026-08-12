using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tangram.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RankOrdinalCollation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "rank",
                table: "columns",
                type: "text",
                nullable: false,
                collation: "C",
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "rank",
                table: "cards",
                type: "text",
                nullable: false,
                collation: "C",
                oldClrType: typeof(string),
                oldType: "text");

            // Repair what the wrong collation already produced.
            //
            // "The last rank" queries were ordering under en_US and so returned
            // the wrong maximum, which let two appends generate the same rank —
            // there are duplicates in the data. Renumbering rewrites every rank,
            // but it preserves the order each board is *displayed* in, because
            // the ALTER above has already made ORDER BY rank ordinal, and the
            // board has always been drawn with StringComparer.Ordinal.
            //
            // Keys are three characters from the same 0-9A-Za-z alphabet
            // RankService uses, so anything generated later still sorts against
            // them and can still find a midpoint between any two.
            const string alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
            // Cast throughout: row_number() is bigint and a bare literal is
            // "unknown", neither of which substr() has an overload for.
            string Key(string n) =>
                $"substr('{alphabet}'::text, ((({n}) / 3844) % 62 + 1)::int, 1) || " +
                $"substr('{alphabet}'::text, ((({n}) / 62) % 62 + 1)::int, 1) || " +
                $"substr('{alphabet}'::text, ((({n}) % 62) + 1)::int, 1)";

            migrationBuilder.Sql($"""
                WITH ordered AS (
                    SELECT id, row_number() OVER (
                        PARTITION BY board_id ORDER BY rank, created_at, id
                    ) - 1 AS n
                    FROM columns
                )
                UPDATE columns c SET rank = {Key("o.n")}
                FROM ordered o WHERE o.id = c.id;
                """);

            migrationBuilder.Sql($"""
                WITH ordered AS (
                    SELECT id, row_number() OVER (
                        PARTITION BY column_id ORDER BY rank, created_at, id
                    ) - 1 AS n
                    FROM cards
                )
                UPDATE cards c SET rank = {Key("o.n")}
                FROM ordered o WHERE o.id = c.id;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "rank",
                table: "columns",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldCollation: "C");

            migrationBuilder.AlterColumn<string>(
                name: "rank",
                table: "cards",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldCollation: "C");
        }
    }
}
