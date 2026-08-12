using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tangram.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddColumnLimits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "max_cards",
                table: "columns",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "min_cards",
                table: "columns",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "max_cards",
                table: "columns");

            migrationBuilder.DropColumn(
                name: "min_cards",
                table: "columns");
        }
    }
}
