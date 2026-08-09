using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tangram.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBoardArchivedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "archived_at",
                table: "boards",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "archived_at",
                table: "boards");
        }
    }
}
